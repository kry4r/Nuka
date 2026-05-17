import { describe, expect, test } from 'vitest'

import { detectImageFormatFromBuffer } from '../../src/promptContextReferences/imageFormat'

describe('detectImageFormatFromBuffer', () => {
  test('PNG magic bytes → image/png', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    expect(detectImageFormatFromBuffer(buffer)).toBe('image/png')
  })

  test('JPEG magic bytes → image/jpeg', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    expect(detectImageFormatFromBuffer(buffer)).toBe('image/jpeg')
  })

  test('GIF magic bytes → image/gif', () => {
    const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(detectImageFormatFromBuffer(buffer)).toBe('image/gif')
  })

  test('WebP RIFF...WEBP → image/webp', () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(detectImageFormatFromBuffer(buffer)).toBe('image/webp')
  })

  test('RIFF without WEBP fourcc falls back to image/png', () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])
    expect(detectImageFormatFromBuffer(buffer)).toBe('image/png')
  })

  test('Buffers shorter than 4 bytes default to image/png', () => {
    expect(detectImageFormatFromBuffer(Buffer.from([0x00]))).toBe('image/png')
  })

  test('Unknown magic bytes default to image/png', () => {
    expect(
      detectImageFormatFromBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03])),
    ).toBe('image/png')
  })
})
