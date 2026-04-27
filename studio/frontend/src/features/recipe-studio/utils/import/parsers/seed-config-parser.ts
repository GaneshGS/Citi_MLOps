// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type {
  SeedConfig,
  SeedSamplingStrategy,
  SeedSelectionType,
  SeedSourceType,
} from "../../../types";
import { isRecord, readNumberString, readString } from "../helpers";

function normalizeSampling(value: unknown): SeedSamplingStrategy {
  const raw = readString(value);
  if (raw === "shuffle") return "shuffle";
  return "ordered";
}

function makeDefaultSeedConfig(id: string): SeedConfig {
  return {
    id,
    kind: "seed",
    name: "seed",
    drop: false,
    seed_drop_columns: [],
    seed_source_type: "hf",
    hf_repo_id: "",
    hf_subset: "",
    hf_split: "",
    hf_path: "",
    hf_token: "",
    hf_endpoint: "https://huggingface.co",
    local_file_name: "",
    unstructured_file_ids: [],
    unstructured_file_names: [],
    unstructured_file_sizes: [],
    seed_preview_rows: [],
    unstructured_chunk_size: "1200",
    unstructured_chunk_overlap: "200",
    gssp_enabled: false,
    gssp_endpoint: "",
    gssp_path: "",
    gssp_auth_token: "",
    gssp_x_correlation_id: "",
    gssp_x_application_id: "",
    gssp_x_soeid: "",
    gssp_x_model_name: "",
    gssp_x_max_tokens: "",
    gssp_x_authorization_coin: "",
    gssp_request_template: "",
    seed_splits: [],
    seed_globs_by_split: {},
    seed_columns: [],
    sampling_strategy: "ordered",
    selection_type: "none",
    selection_start: "0",
    selection_end: "10",
    selection_index: "0",
    selection_num_partitions: "1",
  };
}

function inferRepoIdFromSeedPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[0] === "datasets") {
    return `${parts[1]}/${parts[2]}`;
  }
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return "";
}

function parseSeedSettings(seedConfigRaw: unknown): Partial<SeedConfig> {
  if (!isRecord(seedConfigRaw)) {
    return {};
  }

  const sampling_strategy = normalizeSampling(seedConfigRaw.sampling_strategy);

  let seed_source_type: SeedSourceType = "hf";
  let hf_path = "";
  let hf_token = "";
  let hf_endpoint = "https://huggingface.co";
  let hf_repo_id = "";
  let local_file_name = "";
  let unstructuredFileIds: string[] = [];
  let unstructuredFileNames: string[] = [];
  let unstructuredFileSizes: number[] = [];
  let resolved_paths: string[] = [];
  let unstructured_chunk_size = "1200";
  let unstructured_chunk_overlap = "200";
  const sourceRaw = seedConfigRaw.source;
  if (isRecord(sourceRaw)) {
    const seedType = readString(sourceRaw.seed_type);
    const sourcePath = readString(sourceRaw.path) ?? "";
    if (seedType === "hf") {
      seed_source_type = "hf";
      hf_path = sourcePath;
      hf_token = readString(sourceRaw.token) ?? "";
      hf_endpoint = readString(sourceRaw.endpoint) ?? hf_endpoint;
      hf_repo_id = inferRepoIdFromSeedPath(hf_path);
    } else if (seedType === "local") {
      seed_source_type = "local";
      hf_path = sourcePath;
      local_file_name = sourcePath.split("/").pop() ?? sourcePath;
    } else if (seedType === "unstructured") {
      seed_source_type = "unstructured";
      const paths = Array.isArray(sourceRaw.paths) ? sourceRaw.paths : [];
      const stringPaths = paths.filter((p): p is string => typeof p === "string");
      if (stringPaths.length === 0 && sourcePath) {
        stringPaths.push(sourcePath);
      }
      hf_path = stringPaths[0] ?? sourcePath;
      resolved_paths = stringPaths;
      unstructuredFileIds = [];
      unstructuredFileNames = [];
      unstructured_chunk_size = readNumberString(sourceRaw.chunk_size) || "1200";
      unstructured_chunk_overlap = readNumberString(sourceRaw.chunk_overlap) || "200";
    }
  }

  let selection_type: SeedSelectionType = "none";
  let selection_start = "0";
  let selection_end = "10";
  let selection_index = "0";
  let selection_num_partitions = "1";
  const selectionRaw = seedConfigRaw.selection_strategy;
  if (isRecord(selectionRaw)) {
    if (
      typeof selectionRaw.start === "number" &&
      typeof selectionRaw.end === "number"
    ) {
      selection_type = "index_range";
      selection_start = String(selectionRaw.start);
      selection_end = String(selectionRaw.end);
    } else if (
      typeof selectionRaw.index === "number" &&
      typeof selectionRaw.num_partitions === "number"
    ) {
      selection_type = "partition_block";
      selection_index = String(selectionRaw.index);
      selection_num_partitions = String(selectionRaw.num_partitions);
    }
  }

  return {
    seed_source_type,
    hf_repo_id,
    hf_path,
    hf_token,
    hf_endpoint,
    local_file_name,
    unstructured_file_ids: unstructuredFileIds,
    unstructured_file_names: unstructuredFileNames,
    unstructured_file_sizes: unstructuredFileSizes,
    resolved_paths,
    unstructured_chunk_size,
    unstructured_chunk_overlap,
    gssp_enabled: Boolean(seedConfigRaw.gssp_enabled),
    gssp_endpoint: readString(seedConfigRaw.gssp_endpoint) ?? "",
    gssp_path: readString(seedConfigRaw.gssp_path) ?? "",
    // Auth token is server-only; ignore legacy persisted values
    gssp_auth_token: "",
    gssp_x_correlation_id: readString(seedConfigRaw.gssp_x_correlation_id) ?? "",
    gssp_x_application_id: readString(seedConfigRaw.gssp_x_application_id) ?? "",
    gssp_x_soeid: readString(seedConfigRaw.gssp_x_soeid) ?? "",
    gssp_x_model_name: readString(seedConfigRaw.gssp_x_model_name) ?? "",
    gssp_x_max_tokens: readString(seedConfigRaw.gssp_x_max_tokens) ?? "",
    gssp_x_authorization_coin:
      readString(seedConfigRaw.gssp_x_authorization_coin) ?? "",
    gssp_request_template: readString(seedConfigRaw.gssp_request_template) ?? "",
    sampling_strategy,
    selection_type,
    selection_start,
    selection_end,
    selection_index,
    selection_num_partitions,
  };
}

export function parseSeedConfig(
  seedConfigRaw: unknown,
  id: string,
  options?: {
    preferredSourceType?: SeedSourceType;
    seed_columns?: string[];
    seed_drop_columns?: string[];
    seed_preview_rows?: Record<string, unknown>[];
    local_file_name?: string;
    unstructuredFileIds?: string[];
    unstructuredFileNames?: string[];
    unstructuredFileSizes?: number[];
    unstructured_chunk_size?: string;
    unstructured_chunk_overlap?: string;
    gssp_enabled?: boolean;
    gssp_endpoint?: string;
    gssp_path?: string;
    gssp_auth_token?: string;
    gssp_x_correlation_id?: string;
    gssp_x_application_id?: string;
    gssp_x_soeid?: string;
    gssp_x_model_name?: string;
    gssp_x_max_tokens?: string;
    gssp_x_authorization_coin?: string;
    gssp_request_template?: string;
  },
): SeedConfig | null {
  if (!seedConfigRaw) {
    return null;
  }
  const parsed = parseSeedSettings(seedConfigRaw);
  let sourceType: SeedSourceType = "hf";
  if (parsed.seed_source_type === "hf") {
    sourceType = "hf";
  } else if (options?.preferredSourceType) {
    sourceType = options.preferredSourceType;
  } else if (parsed.seed_source_type) {
    sourceType = parsed.seed_source_type;
  }
  return {
    ...makeDefaultSeedConfig(id),
    ...parsed, // payload-only fields override ui defaults
    seed_source_type: sourceType,
    ...(options?.seed_columns ? { seed_columns: options.seed_columns } : {}),
    ...(options?.seed_drop_columns
      ? { seed_drop_columns: options.seed_drop_columns }
      : {}),
    ...(options?.seed_preview_rows
      ? { seed_preview_rows: options.seed_preview_rows }
      : {}),
    ...(options?.local_file_name !== undefined
      ? { local_file_name: options.local_file_name }
      : {}),
    ...(options?.unstructuredFileIds !== undefined
      ? { unstructured_file_ids: options.unstructuredFileIds }
      : {}),
    ...(options?.unstructuredFileNames !== undefined
      ? { unstructured_file_names: options.unstructuredFileNames }
      : {}),
    ...(options?.unstructuredFileSizes !== undefined
      ? { unstructured_file_sizes: options.unstructuredFileSizes }
      : {}),
    ...(options?.unstructured_chunk_size !== undefined
      ? { unstructured_chunk_size: options.unstructured_chunk_size }
      : {}),
    ...(options?.unstructured_chunk_overlap !== undefined
      ? { unstructured_chunk_overlap: options.unstructured_chunk_overlap }
      : {}),
    ...(options?.gssp_enabled !== undefined
      ? { gssp_enabled: options.gssp_enabled }
      : {}),
    ...(options?.gssp_endpoint !== undefined
      ? { gssp_endpoint: options.gssp_endpoint }
      : {}),
    ...(options?.gssp_path !== undefined ? { gssp_path: options.gssp_path } : {}),
    ...(options?.gssp_auth_token !== undefined
      ? { gssp_auth_token: options.gssp_auth_token }
      : {}),
    ...(options?.gssp_x_correlation_id !== undefined
      ? { gssp_x_correlation_id: options.gssp_x_correlation_id }
      : {}),
    ...(options?.gssp_x_application_id !== undefined
      ? { gssp_x_application_id: options.gssp_x_application_id }
      : {}),
    ...(options?.gssp_x_soeid !== undefined
      ? { gssp_x_soeid: options.gssp_x_soeid }
      : {}),
    ...(options?.gssp_x_model_name !== undefined
      ? { gssp_x_model_name: options.gssp_x_model_name }
      : {}),
    ...(options?.gssp_x_max_tokens !== undefined
      ? { gssp_x_max_tokens: options.gssp_x_max_tokens }
      : {}),
    ...(options?.gssp_x_authorization_coin !== undefined
      ? { gssp_x_authorization_coin: options.gssp_x_authorization_coin }
      : {}),
    ...(options?.gssp_request_template !== undefined
      ? { gssp_request_template: options.gssp_request_template }
      : {}),
  };
}
