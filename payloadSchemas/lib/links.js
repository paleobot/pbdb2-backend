// A property whose value links to another resource. Every link has the same
// shape: the target's permid (the only writable key), one of the target's own
// fields as a read-only label, and a read-only href the API adds. The field
// names are the target's own, so a later include of the whole target only adds
// fields (api/docs/response-contracts.md §4).
//
// x-link names the target's route group (for the API's href) and the label
// field (for the codec context, which reads it from the codec's source). The
// storage layer never builds or reads href.
// See openspec/specs/payload-schema-variants/spec.md.

export function link({ target, label }) {
  return {
    type: 'object',
    properties: {
      permid: { type: 'string', description: 'permid of the linked resource' },
      [label]: { type: 'string', readOnly: true },
      href: { type: 'string', readOnly: true, description: 'read URL of the linked resource' },
    },
    required: ['permid'],
    additionalProperties: false,
    'x-link': { target, label },
  };
}
