// Shared ajv factory for payload schemas: draft 2020-12, the schema dialect of
// OpenAPI 3.1, so schemas are tested under the draft a published description
// applies (unevaluatedProperties rules out drafts before 2019-09); strict mode;
// and the x-* annotations the annotated sources use registered as
// annotation-only keywords so strict mode accepts them. strictRequired is off: x-create is merged as an allOf entry whose
// `required` names properties defined on the parent node, which is valid JSON
// Schema but trips that check. See openspec/specs/payload-schema-variants/spec.md.
import Ajv2020 from 'ajv/dist/2020.js';

export const ANNOTATION_KEYWORDS = ['x-enumFrom', 'x-storage', 'x-create', 'x-link', 'x-variant'];

export function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  for (const keyword of ANNOTATION_KEYWORDS) ajv.addKeyword({ keyword });
  return ajv;
}
