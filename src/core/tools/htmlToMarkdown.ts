import TurndownService from 'turndown'

const td = new TurndownService()

export function htmlToMarkdown(html: string): string {
  return td.turndown(html)
}
