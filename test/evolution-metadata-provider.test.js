import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EVOLUTION_CATALOG_CONTRACT,
  EVOLUTION_METADATA_EVIDENCE_CONTRACT,
  EVOLUTION_METADATA_LIMITS,
  EVOLUTION_METADATA_REQUEST_CONTRACT,
  EVOLUTION_METADATA_SCHEMA_VERSION,
  EvolutionMetadataEvidenceState,
  EvolutionMetadataGameVersion,
  EvolutionMetadataProviderState,
  NotConfiguredEvolutionMetadataProvider,
  createEvolutionMetadataEvidence,
  createEvolutionMetadataProviderDescriptor,
  createEvolutionMetadataRequest,
  validateEvolutionMetadataEvidence,
  validateEvolutionMetadataRequest,
} from "../src/application/evolution-metadata-provider.js";
import {
  PRO_CONTRACT_ERROR_CODES,
  ProContractError,
} from "../src/application/pro-contracts/errors.js";

const requestInput = (overrides = {}) => ({
  schemaVersion: EVOLUTION_METADATA_SCHEMA_VERSION,
  contract: EVOLUTION_METADATA_REQUEST_CONTRACT,
  requestId: "evo_request_1",
  gameVersion: EvolutionMetadataGameVersion.FC26,
  createdAt: 1_000,
  expiresAt: 2_000,
  ...overrides,
});

const errorCode = (code) => (error) => {
  assert.equal(error instanceof ProContractError, true);
  assert.equal(error.code, code);
  return true;
};

test("Evolution metadata requests are exact, bounded, immutable, and version-neutral", () => {
  const first = createEvolutionMetadataRequest(requestInput());
  const second = createEvolutionMetadataRequest(requestInput());
  const fc27 = createEvolutionMetadataRequest(requestInput({
    requestId: "evo_request_27",
    gameVersion: EvolutionMetadataGameVersion.FC27,
  }));

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(fc27.gameVersion, "fc27");
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(validateEvolutionMetadataRequest(first, { now: 1_500 }), first);
  assert.throws(
    () => createEvolutionMetadataRequest(requestInput({ inventedQuery: "live-shape" })),
    errorCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
  assert.throws(
    () => createEvolutionMetadataRequest(requestInput({
      expiresAt: 1_000 + EVOLUTION_METADATA_LIMITS.maxRequestTtlMs + 1,
    })),
    errorCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});

test("not-configured Evolution metadata provider is explicit, immutable, and closed", async () => {
  const provider = new NotConfiguredEvolutionMetadataProvider();
  const descriptor = provider.describe();
  const request = createEvolutionMetadataRequest(requestInput());

  assert.equal(Object.isFrozen(provider), true);
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(descriptor.state, EvolutionMetadataProviderState.NOT_CONFIGURED);
  assert.equal(descriptor.catalogContract, EVOLUTION_CATALOG_CONTRACT);
  assert.deepEqual(descriptor.supportedGameVersions, []);
  assert.equal(descriptor.maxDefinitions, 0);
  await assert.rejects(
    provider.readCatalog(request),
    errorCode(PRO_CONTRACT_ERROR_CODES.PROVIDER_NOT_CONFIGURED),
  );
});

test("not-configured provider validates requests before returning its stable error", async () => {
  const provider = new NotConfiguredEvolutionMetadataProvider();
  await assert.rejects(
    provider.readCatalog({ ...requestInput(), extra: true }),
    errorCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
});

test("metadata evidence is exact, immutable, and bound to request and descriptor", () => {
  const request = createEvolutionMetadataRequest(requestInput());
  const descriptor = createEvolutionMetadataProviderDescriptor({
    providerId: "reviewed_fixture_catalog",
    state: EvolutionMetadataProviderState.READY,
    supportedGameVersions: [EvolutionMetadataGameVersion.FC27, EvolutionMetadataGameVersion.FC26],
    catalogContract: EVOLUTION_CATALOG_CONTRACT,
    maxDefinitions: 20,
  });
  const evidence = createEvolutionMetadataEvidence({
    schemaVersion: EVOLUTION_METADATA_SCHEMA_VERSION,
    contract: EVOLUTION_METADATA_EVIDENCE_CONTRACT,
    providerId: descriptor.providerId,
    state: EvolutionMetadataEvidenceState.VERIFIED,
    requestId: request.requestId,
    requestFingerprint: request.fingerprint,
    gameVersion: request.gameVersion,
    catalogContract: EVOLUTION_CATALOG_CONTRACT,
    catalogVersion: "fixture_1",
    catalogFingerprint: "fnv1a32_catalog1",
    definitionCount: 3,
    observedAt: 1_100,
    expiresAt: 1_900,
  });

  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(
    validateEvolutionMetadataEvidence(evidence, { request, descriptor, now: 1_500 }),
    evidence,
  );
  assert.throws(
    () => createEvolutionMetadataEvidence({ ...evidence, executableAction: "activate" }),
    errorCode(PRO_CONTRACT_ERROR_CODES.CONTRACT_INVALID),
  );
  assert.throws(
    () => validateEvolutionMetadataEvidence(
      { ...evidence, requestFingerprint: "fnv1a32_wrong" },
      { request, descriptor, now: 1_500 },
    ),
    errorCode(PRO_CONTRACT_ERROR_CODES.RESPONSE_MISMATCH),
  );
});

test("Evolution metadata provider source has no transport or execution coupling", async () => {
  const source = await readFile(
    new URL("../src/application/evolution-metadata-provider.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\//i);
  assert.doesNotMatch(source, /\b(?:endpoint|token|browser|controller|workflow)\b/i);
  assert.doesNotMatch(source, /\b(?:command|steps|activate|complete)\b/i);
});
