/**
 * GENERATED FILE - do not edit by hand.
 * Corpus manifest: version, layout, counts and per-file integrity hashes.
 * Source: The Metropolitan Museum of Art Open Access (CC0 1.0), ingested
 * 2026-11-17T17:12:06.198Z.
 * Regenerate with: node scripts/culture/build.mjs
 */
import type { CultureCategory, CultureContinent } from "../types";

export const CULTURE_DATA_VERSION = 1;
export const CHUNK_SIZE = 80;
export const CHUNK_COUNT = 8;
export const TOTAL_ITEMS = 595;
export const INGESTED_AT = "2026-11-17T17:12:06.198Z";
export const SOURCE = {
  organization: "The Metropolitan Museum of Art",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  api: "https://collectionapi.metmuseum.org/public/collection/v1",
} as const;

export const COUNTS = {
  byContinent: {
    africa: 97,
    asia: 237,
    europe: 116,
    "north-america": 55,
    oceania: 1,
    "south-america": 89,
  },
  byCategory: {
    architecture: 4,
    crafts: 160,
    design: 15,
    "everyday-life": 84,
    landscapes: 23,
    language: 16,
    "medicine-knowledge": 1,
    music: 42,
    objects: 25,
    "ritual-objects": 19,
    storytelling: 11,
    textiles: 109,
    tools: 47,
    trade: 39,
  },
} as const;

export const FILES: Record<string, { bytes: number; sha256: string }> = {
  "index.ts": {
    bytes: 285947,
    sha256: "280c015d5dd76e30262762f148162805ac82a02a1d0878c41365e0db9cf4dfd2",
  },
  "chunk-0.ts": {
    bytes: 151028,
    sha256: "00b9fe4980d58e1d80e3e8c597ddbed42c1ed4e01b7775b891d3b7c056df60fd",
  },
  "chunk-1.ts": {
    bytes: 135065,
    sha256: "1ed2b3ff1e31609c2e35d23e39fe9b77abc1ab7a80b323b646981c4ab7c2eb01",
  },
  "chunk-2.ts": {
    bytes: 130693,
    sha256: "27fb8adbf243fcde4277ed412547bacf3118af86eede13ff22731e68a6bdd447",
  },
  "chunk-3.ts": {
    bytes: 129997,
    sha256: "71f7e32f202e129129c20993aadda19c8210f44d0ea9f9a36a9155b2ead5a222",
  },
  "chunk-4.ts": {
    bytes: 126709,
    sha256: "60daaf73857a99282981f6243adc6c0a6a19eab8719ecb97eabd787087bfabb6",
  },
  "chunk-5.ts": {
    bytes: 139822,
    sha256: "6decf48b1fc9d7cfc8a18a81a831b6687f4afa059ba397adc66ad57b910344af",
  },
  "chunk-6.ts": {
    bytes: 127352,
    sha256: "31624fd91531c6fce3c24b196480937b038b847f6464b40b7f52f3d777ac609b",
  },
  "chunk-7.ts": {
    bytes: 58127,
    sha256: "7244a20adbfbd19b3a2ac6af954baeb23b118c17172e699a89952a5440aecd11",
  },
};

export const INDEX_BYTES = 231198;
export const INDEX_GZIP_BYTES = 23541;
