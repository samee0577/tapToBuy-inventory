/**
 * End-to-end check of the Cloudinary upload round trip against the real account.
 *
 * The signature algorithm is implemented by hand rather than taken from the
 * official SDK, so unit tests alone cannot prove it is right: only Cloudinary
 * accepting the signature proves that. This script exercises the whole path —
 *
 *   presign  ->  browser-style multipart POST to Cloudinary  ->  complete
 *
 * and then removes the test asset so it does not linger in the account.
 *
 * Run with:  pnpm --filter @inventory/api cloudinary:verify
 */
import '../src/config/load-env.js';

import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

import { cloudinaryEnv } from '../src/config/env.js';
import { completeUpload, presignUpload } from '../src/modules/uploads/upload.service.js';
import { destroyAsset } from '../src/modules/uploads/cloudinary.service.js';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Builds a valid solid-colour PNG. Generated rather than checked in so the test
 * has no binary fixture in the repository, and sized above the minimum dimension
 * the upload validation enforces.
 */
function buildTestPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: truecolour RGB
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 3));
  const lastX = Math.max(1, width - 1);
  const lastY = Math.max(1, height - 1);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw.writeUInt8(0, rowStart);

    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      // Gradients stay inside 40..160 / 90..210 so no channel overflows a byte.
      raw.writeUInt8(40 + Math.round((x / lastX) * 120), pixel);
      raw.writeUInt8(90 + Math.round((y / lastY) * 120), pixel + 1);
      raw.writeUInt8(160, pixel + 2);
    }
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main(): Promise<void> {
  const env = cloudinaryEnv();
  console.log(`Cloud name: ${env.CLOUDINARY_CLOUD_NAME}`);
  console.log(`Allowed formats: ${env.CLOUDINARY_ALLOWED_FORMATS.join(', ')}`);

  const size = Math.max(600, env.CLOUDINARY_MIN_DIMENSION + 200);
  const png = buildTestPng(size, size);
  console.log(`Generated a ${size}x${size} test PNG (${png.length} bytes)\n`);

  // No database user is needed: the upload grant embeds whatever id it is given
  // and the verification step only checks that the same id comes back.
  const userId = randomUUID();

  console.log('1. Requesting a signed upload ticket...');
  const ticket = await presignUpload(
    { fileName: 'cloudinary-verify.png', contentType: 'image/png', sizeBytes: png.length },
    userId,
  );
  console.log(`   publicId: ${ticket.publicId}`);
  console.log(`   uploadUrl: ${ticket.uploadUrl}`);

  console.log('\n2. Uploading directly to Cloudinary (signature must be accepted)...');
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) {
    form.append(key, value);
  }
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'verify.png');

  const uploadResponse = await fetch(ticket.uploadUrl, { method: 'POST', body: form });
  const uploadPayload = (await uploadResponse.json()) as {
    public_id?: string;
    error?: { message?: string };
  };

  if (!uploadResponse.ok) {
    throw new Error(
      `Cloudinary rejected the upload (HTTP ${uploadResponse.status}): ` +
        `${uploadPayload.error?.message ?? 'no message'}`,
    );
  }

  console.log(`   accepted. Cloudinary reports public_id: ${uploadPayload.public_id}`);

  console.log('\n3. Verifying the stored asset through the API...');
  const verified = await completeUpload(ticket.publicId, ticket.uploadToken, userId);
  console.log(`   verified: ${verified.width}x${verified.height} ${verified.format}, ${verified.bytes} bytes`);
  console.log(`   imageUrl: ${verified.imageUrl}`);

  console.log('\n4. Confirming the delivery URL actually serves an image...');
  const delivery = await fetch(verified.imageUrl);
  const contentType = delivery.headers.get('content-type') ?? '';
  if (!delivery.ok || !contentType.startsWith('image/')) {
    throw new Error(
      `Delivery URL did not return an image (HTTP ${delivery.status}, type ${contentType})`,
    );
  }
  console.log(`   served ${delivery.headers.get('content-length') ?? '?'} bytes as ${contentType}`);

  console.log('\n5. Requesting a resized variant through the transform helper...');
  const { withImageTransform } = await import('@inventory/shared');
  const thumbnail = withImageTransform(verified.imageUrl, {
    width: 200,
    height: 200,
    crop: 'fill',
    format: 'auto',
    quality: 'auto',
  });
  const thumbnailResponse = await fetch(thumbnail);
  if (!thumbnailResponse.ok) {
    throw new Error(`Transformed URL failed (HTTP ${thumbnailResponse.status}): ${thumbnail}`);
  }
  console.log(`   ${thumbnail}`);
  console.log(
    `   served as ${thumbnailResponse.headers.get('content-type')} (auto format negotiation)`,
  );

  console.log('\n6. Removing the test asset...');
  await destroyAsset(ticket.publicId);
  console.log('   done');

  console.log('\nCloudinary round trip verified end to end.');
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nVERIFICATION FAILED: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // No database handle to close: nothing here touches Postgres.
  });
