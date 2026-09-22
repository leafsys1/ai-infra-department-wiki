"use strict";

/**
 * Dependency-free JSON Schema (draft 2020-12 subset) validator.
 *
 * The department schemas ship with the Skill and are the machine-readable contract for records and
 * gate reports. Before this module existed they were documentation only: nothing loaded them, so
 * they could drift away from the hand-written validator without any test noticing. Both now agree,
 * and tests assert the agreement.
 *
 * Supported keywords: $ref (local file), type, const, enum, required, properties,
 * additionalProperties, items, minItems, maxItems, uniqueItems, minLength, maxLength, pattern,
 * minimum, maximum, allOf, anyOf, oneOf, if/then/else, not.
 */

const fs = require("node:fs");
const path = require("node:path");

const TYPE_CHECKS = Object.freeze({
  object: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null,
});

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class SchemaSet {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.cache = new Map();
  }

  load(fileName) {
    if (this.cache.has(fileName)) return this.cache.get(fileName);
    const file = path.join(this.directory, fileName);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`cannot load schema ${fileName}: ${error.message}`);
    }
    this.cache.set(fileName, parsed);
    return parsed;
  }

  /**
   * Validate a document against one schema file.
   * Returns { valid, errors: [{ path, keyword, message }] } with deterministic ordering.
   */
  validate(document, fileName) {
    const errors = [];
    this.#node(this.load(fileName), document, "", errors, fileName);
    return {
      valid: errors.length === 0,
      errors: errors.map((error) => ({ path: error.path, keyword: error.keyword, message: error.message })),
    };
  }

  #node(schema, value, instancePath, errors, fileName) {
    if (typeof schema === "boolean") {
      if (!schema) errors.push({ path: instancePath, keyword: "false", message: "value is rejected by the schema" });
      return;
    }
    if (!isPlainObject(schema)) return;

    const where = instancePath || "<root>";
    const fail = (keyword, message) => errors.push({ path: instancePath, keyword, message });

    if (typeof schema.$ref === "string") {
      const [refFile, pointer] = schema.$ref.split("#");
      const targetFile = refFile || fileName;
      let target = this.load(targetFile);
      if (pointer) {
        for (const segment of pointer.split("/").filter(Boolean)) {
          const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
          target = target === undefined ? undefined : target[key];
        }
      }
      if (target === undefined) {
        fail("$ref", `unresolvable $ref: ${schema.$ref}`);
        return;
      }
      this.#node(target, value, instancePath, errors, targetFile);
    }

    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
      fail("const", `${where}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))) {
      fail("enum", `${where}: ${JSON.stringify(value)} is not one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
    }

    if (schema.type !== undefined) {
      const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
      const matches = allowed.some((name) => (TYPE_CHECKS[name] ? TYPE_CHECKS[name](value) : true));
      if (!matches) {
        fail("type", `${where}: expected ${allowed.join(" or ")}, got ${describeType(value)}`);
        return;
      }
    }

    if (typeof value === "string") {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        fail("minLength", `${where}: needs at least ${schema.minLength} character(s)`);
      }
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        fail("maxLength", `${where}: allows at most ${schema.maxLength} character(s)`);
      }
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
        fail("pattern", `${where}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
      }
    }

    if (typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum) fail("minimum", `${where}: must be >= ${schema.minimum}`);
      if (typeof schema.maximum === "number" && value > schema.maximum) fail("maximum", `${where}: must be <= ${schema.maximum}`);
    }

    if (isPlainObject(value)) {
      for (const key of Array.isArray(schema.required) ? schema.required : []) {
        if (value[key] === undefined) fail("required", `${where}: missing required property ${key}`);
      }
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      for (const key of Object.keys(value)) {
        const childPath = `${instancePath}/${key}`;
        if (properties[key] !== undefined) {
          this.#node(properties[key], value[key], childPath, errors, fileName);
          continue;
        }
        if (schema.additionalProperties === false) {
          errors.push({ path: childPath, keyword: "additionalProperties", message: `${childPath}: property is not allowed` });
        } else if (isPlainObject(schema.additionalProperties)) {
          this.#node(schema.additionalProperties, value[key], childPath, errors, fileName);
        }
      }
    }

    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) fail("minItems", `${where}: needs at least ${schema.minItems} item(s)`);
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) fail("maxItems", `${where}: allows at most ${schema.maxItems} item(s)`);
      if (schema.uniqueItems === true) {
        const seen = new Set();
        for (const item of value) {
          const key = JSON.stringify(item);
          if (seen.has(key)) fail("uniqueItems", `${where}: duplicate item ${key}`);
          seen.add(key);
        }
      }
      if (schema.items !== undefined) {
        value.forEach((item, index) => this.#node(schema.items, item, `${instancePath}/${index}`, errors, fileName));
      }
    }

    for (const branch of Array.isArray(schema.allOf) ? schema.allOf : []) {
      this.#node(branch, value, instancePath, errors, fileName);
    }

    if (Array.isArray(schema.anyOf)) {
      const matched = schema.anyOf.some((branch) => {
        const branchErrors = [];
        this.#node(branch, value, instancePath, branchErrors, fileName);
        return branchErrors.length === 0;
      });
      if (!matched) fail("anyOf", `${where}: matched none of the allowed alternatives`);
    }

    if (Array.isArray(schema.oneOf)) {
      const matches = schema.oneOf.filter((branch) => {
        const branchErrors = [];
        this.#node(branch, value, instancePath, branchErrors, fileName);
        return branchErrors.length === 0;
      }).length;
      if (matches !== 1) fail("oneOf", `${where}: must match exactly one alternative, matched ${matches}`);
    }

    if (schema.not !== undefined) {
      const branchErrors = [];
      this.#node(schema.not, value, instancePath, branchErrors, fileName);
      if (branchErrors.length === 0) fail("not", `${where}: matches a disallowed shape`);
    }

    if (schema.if !== undefined) {
      const conditionErrors = [];
      this.#node(schema.if, value, instancePath, conditionErrors, fileName);
      const branch = conditionErrors.length === 0 ? schema.then : schema.else;
      if (branch !== undefined) this.#node(branch, value, instancePath, errors, fileName);
    }
  }
}

module.exports = { SchemaSet };
