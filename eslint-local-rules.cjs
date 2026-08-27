/* eslint-env node */
'use strict'

// Guards against "OJ" and "CM" creeping back into the codebase after the
// chore/rename-oj-cm-acronyms cleanup: both were undocumented two-letter
// acronyms ("Operator Journey" and "Case Management") that made the code
// harder to follow for anyone not already carrying that tribal knowledge.
// Runs as part of the normal `npm run lint`, no separate CI step.
// Loaded automatically by eslint-plugin-local-rules (see .eslintrc.cjs).

const BANNED = new Map([
  ['OJ', 'Registration & Accreditation service'],
  ['CM', 'Case Management service']
])
const WORD_RE = /\b(OJ|CM)\b/i

// Digit runs are split out as their own tokens too (so `cm2`/`ra447Cm6Tests`
// isolate a bare 'Cm' segment) — digits are word characters, so without this
// an identifier like `cm2` would dodge the word-boundary check above
// entirely.
function splitWords(name) {
  return name
    .replace(/(\d+)/g, ' $1 ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/[\s_-]+/)
}

module.exports = {
  'no-undocumented-service-acronyms': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'Disallow the undocumented acronyms OJ/CM; use their full service names instead.'
      },
      schema: [],
      messages: {
        banned: "Avoid the acronym '{{term}}' — spell out '{{full}}' instead (see chore/rename-oj-cm-acronyms)."
      }
    },
    create(context) {
      function check(node, text) {
        if (!text) return
        const match = text.match(WORD_RE)
        if (match) {
          const term = match[1].toUpperCase()
          context.report({ node, messageId: 'banned', data: { term, full: BANNED.get(term) } })
        }
      }

      return {
        Program() {
          const comments = context.getSourceCode().getAllComments()
          for (const comment of comments) check(comment, comment.value)
        },
        Literal(node) {
          if (typeof node.value === 'string') check(node, node.value)
        },
        TemplateElement(node) {
          check(node, node.value.raw)
        },
        Identifier(node) {
          for (const word of splitWords(node.name)) {
            const upper = word.toUpperCase()
            if (upper === 'OJ' || upper === 'CM') {
              context.report({ node, messageId: 'banned', data: { term: upper, full: BANNED.get(upper) } })
              break
            }
          }
        }
      }
    }
  }
}
