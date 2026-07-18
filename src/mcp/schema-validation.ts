export type JsonSchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

/** JSON-Schema subset used by MCP tool input contracts. */
export interface JsonSchema {
  type?: JsonSchemaType;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

/**
 * Validate a value from the same schema published by `tools/list`.
 * Returns the first concise, field-specific error or null when valid.
 */
export function validateSchemaValue(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  const typeError = validateType(schema.type, value, path);
  if (typeError) return typeError;

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} must be one of: ${schema.enum.map(formatValue).join(", ")}`;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} must be >= ${schema.minimum}`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} must be <= ${schema.maximum}`;
    }
  }

  if (schema.type === "object" && isRecord(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) return `${path}.${required} is required`;
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
      if (unknown) return `${path}.${unknown} is not allowed`;
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      const error = validateSchemaValue(propertySchema, value[key], `${path}.${key}`);
      if (error) return error;
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const error = validateSchemaValue(schema.items, item, `${path}[${index}]`);
      if (error) return error;
    }
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateType(type: JsonSchemaType | undefined, value: unknown, path: string): string | null {
  if (!type) return null;
  const valid =
    (type === "object" && isRecord(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (type === "integer" && typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);
  return valid ? null : `${path} must be ${article(type)} ${type}`;
}

function article(type: JsonSchemaType): "a" | "an" {
  return type === "object" || type === "array" || type === "integer" ? "an" : "a";
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : JSON.stringify(value);
}
