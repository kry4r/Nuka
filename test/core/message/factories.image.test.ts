// test/core/message/factories.image.test.ts
//
// Image-variant coverage for `makeUserMessage`. The factory must accept an
// optional `images` array of `ImageContentBlock` and emit them after the
// text block (or as the only content when text is empty).

import { describe, expect, it } from 'vitest'
import { makeUserMessage } from '../../../src/core/message/factories'

describe('makeUserMessage', () => {
  it('returns a text-only block when no images are provided', () => {
    const m = makeUserMessage({ text: 'hello' })
    expect(m.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('appends image blocks after the text block', () => {
    const m = makeUserMessage({
      text: 'look at this',
      images: [
        { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
        { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
      ],
    })
    expect(m.content).toEqual([
      { type: 'text', text: 'look at this' },
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
      { type: 'image', mediaType: 'image/jpeg', url: 'https://example.test/x.jpg' },
    ])
  })

  it('omits the text block when text is empty but images are present', () => {
    const m = makeUserMessage({
      text: '',
      images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
    })
    expect(m.content).toEqual([
      { type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' },
    ])
  })
})
