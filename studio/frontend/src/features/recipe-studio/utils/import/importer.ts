// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type {
  LlmConfig,
  LlmMcpProviderConfig,
  LlmToolConfig,
  NodeConfig,
  RecipeProcessorConfig,
  SeedConfig,
  SamplerConfig,
  SeedSourceType,
  ToolProfileConfig,
  ValidatorConfig,
} from "../../types";
import { buildEdges } from "./edges";
import { isRecord, parseJson, readString } from "./helpers";
import {
  parseColumn,
  parseModelConfig,
  parseModelProvider,
} from "./parsers";
import { parseSeedConfig } from "./parsers/seed-config-parser";
import { buildNodes, parseUi } from "./ui";
import type { ImportResult } from "./types";

type RecipeInput = {
  columns?: unknown;
  model_configs?: unknown;
  model_providers?: unknown;
  mcp_providers?: unknown;
  tool_configs?: unknown;
  processors?: unknown;
  seed_config?: unknown;
};

type UiInput = {
  nodes?: unknown;
  edges?: unknown;
  seed_source_type?: unknown;
  seed_columns?: unknown;
  seed_drop_columns?: unknown;
  seed_preview_rows?: unknown;
  local_file_name?: unknown;
  unstructured_file_ids?: unknown;
  unstructured_file_names?: unknown;
  unstructured_file_sizes?: unknown;
  unstructured_chunk_size?: unknown;
  unstructured_chunk_overlap?: unknown;
  gssp_enabled?: unknown;
  gssp_endpoint?: unknown;
  gssp_path?: unknown;
  gssp_auth_token?: unknown;
  gssp_x_correlation_id?: unknown;
  gssp_x_application_id?: unknown;
  gssp_x_soeid?: unknown;
  gssp_x_model_name?: unknown;
  gssp_x_max_tokens?: unknown;
  gssp_x_authorization_coin?: unknown;
  gssp_request_template?: unknown;
  advanced_open_by_node?: unknown;
};

function readStringNumber(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function parseProcessors(input: unknown): RecipeProcessorConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const processors: RecipeProcessorConfig[] = [];
  input.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    const type = readString(item.processor_type);
    const templateRaw = item.template;
    const isSchemaTransform =
      type === "schema_transform" || isRecord(templateRaw);
    if (!isSchemaTransform) {
      return;
    }
    const name = readString(item.name) ?? `schema_transform_${index + 1}`;
    const template =
      typeof templateRaw === "string"
        ? templateRaw
        : isRecord(templateRaw)
          ? JSON.stringify(templateRaw, null, 2)
          : "{\n  \"text\": \"{{ column_name }}\"\n}";
    processors.push({
      id: `p${index + 1}`,
      // biome-ignore lint/style/useNamingConvention: api schema
      processor_type: "schema_transform",
      name,
      template,
    });
  });
  return processors;
}

function parseSeedDropColumns(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const values = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    const type = readString(item.processor_type);
    if (type !== "drop_columns") {
      continue;
    }
    const name = readString(item.name);
    if (name !== "drop_seed_columns") {
      continue;
    }
    const columnNames = Array.isArray(item.column_names)
      ? item.column_names
      : [];
    for (const columnName of columnNames) {
      if (typeof columnName !== "string") {
        continue;
      }
      const next = columnName.trim();
      if (next) {
        values.add(next);
      }
    }
  }
  return Array.from(values);
}

function parseMcpProviders(
  input: unknown,
): Map<string, LlmMcpProviderConfig> {
  const providers = new Map<string, LlmMcpProviderConfig>();
  if (!Array.isArray(input)) {
    return providers;
  }
  input.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    const name = readString(item.name)?.trim();
    if (!name) {
      return;
    }
    const providerTypeRaw = readString(item.provider_type);
    const providerType =
      providerTypeRaw === "stdio" ? "stdio" : "streamable_http";
    const args = Array.isArray(item.args)
      ? item.args.map((value) => String(value))
      : [];
    const envPairs =
      isRecord(item.env)
        ? Object.entries(item.env).map(([key, value]) => ({
            key: String(key),
            value: String(value),
          }))
        : [];
    providers.set(name, {
      id: `mcp-${index + 1}`,
      name,
      // biome-ignore lint/style/useNamingConvention: ui schema
      provider_type: providerType,
      command: readString(item.command) ?? "",
      args,
      env: envPairs,
      endpoint: readString(item.endpoint) ?? "",
      // biome-ignore lint/style/useNamingConvention: api schema
      api_key: readString(item.api_key) ?? "",
      // biome-ignore lint/style/useNamingConvention: api schema
      api_key_env: readString(item.api_key_env) ?? "",
    });
  });
  return providers;
}

function parseToolConfigs(input: unknown): Map<string, LlmToolConfig> {
  const toolConfigs = new Map<string, LlmToolConfig>();
  if (!Array.isArray(input)) {
    return toolConfigs;
  }
  input.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    const toolAlias = readString(item.tool_alias)?.trim();
    if (!toolAlias) {
      return;
    }
    const providers = Array.isArray(item.providers)
      ? item.providers.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const allowTools = Array.isArray(item.allow_tools)
      ? item.allow_tools.map((value) => String(value).trim()).filter(Boolean)
      : [];
    toolConfigs.set(toolAlias, {
      id: `tool-${index + 1}`,
      // biome-ignore lint/style/useNamingConvention: api schema
      tool_alias: toolAlias,
      providers,
      // biome-ignore lint/style/useNamingConvention: api schema
      allow_tools: allowTools,
      // biome-ignore lint/style/useNamingConvention: api schema
      max_tool_call_turns:
        item.max_tool_call_turns === null || item.max_tool_call_turns === undefined
          ? "5"
          : String(item.max_tool_call_turns),
      // biome-ignore lint/style/useNamingConvention: api schema
      timeout_sec:
        item.timeout_sec === null || item.timeout_sec === undefined
          ? ""
          : String(item.timeout_sec),
    });
  });
  return toolConfigs;
}

function cloneMcpProvider(config: LlmMcpProviderConfig): LlmMcpProviderConfig {
  return {
    ...config,
    args: [...(config.args ?? [])],
    env: [...(config.env ?? [])],
  };
}

function parseUiToolProfileNodes(input: unknown): Map<string, Record<string, string[]>> {
  const toolProfiles = new Map<string, Record<string, string[]>>();
  if (!Array.isArray(input)) {
    return toolProfiles;
  }
  for (const node of input) {
    if (!isRecord(node)) {
      continue;
    }
    const nodeType = readString(node.node_type) ?? readString(node.type);
    if (nodeType !== "tool_config") {
      continue;
    }
    const name = readString(node.name) ?? readString(node.id);
    if (!name?.trim()) {
      continue;
    }
    const rawToolsByProvider = isRecord(node.tools_by_provider)
      ? node.tools_by_provider
      : null;
    if (!rawToolsByProvider) {
      continue;
    }
    const toolsByProvider = Object.fromEntries(
      Object.entries(rawToolsByProvider).flatMap(([providerName, tools]) => {
        const trimmedName = providerName.trim();
        if (!trimmedName || !Array.isArray(tools)) {
          return [];
        }
        const values = Array.from(
          new Set(tools.map((value) => String(value).trim()).filter(Boolean)),
        );
        return values.length > 0 ? [[trimmedName, values]] : [];
      }),
    );
    toolProfiles.set(name.trim(), toolsByProvider);
  }
  return toolProfiles;
}

function parseAdvancedOpenByNode(input: unknown): Record<string, boolean> {
  if (!isRecord(input)) {
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const [nameRaw, value] of Object.entries(input)) {
    const name = nameRaw.trim();
    if (!name || typeof value !== "boolean") {
      continue;
    }
    out[name] = value;
  }
  return out;
}

type AdvancedOpenConfig = LlmConfig | SamplerConfig | SeedConfig | ValidatorConfig;

function isAdvancedOpenConfig(config: NodeConfig): config is AdvancedOpenConfig {
  return (
    config.kind === "llm" ||
    config.kind === "sampler" ||
    config.kind === "seed" ||
    config.kind === "validator"
  );
}

function applyAdvancedOpen(
  config: NodeConfig,
  advancedOpenByNode: Record<string, boolean>,
): void {
  if (!isAdvancedOpenConfig(config)) {
    return;
  }
  config.advancedOpen = advancedOpenByNode[config.name] === true;
}

function buildToolProfileConfig(
  toolConfig: LlmToolConfig,
  toolConfigsByAlias: Map<string, LlmToolConfig>,
  mcpProvidersByName: Map<string, LlmMcpProviderConfig>,
  fetchedToolsByProfileName: Map<string, Record<string, string[]>>,
  id: string,
): ToolProfileConfig {
  const canonical = toolConfigsByAlias.get(toolConfig.tool_alias) ?? toolConfig;
  return {
    id,
    kind: "tool_config",
    name: canonical.tool_alias,
    // biome-ignore lint/style/useNamingConvention: ui schema
    mcp_providers: canonical.providers
      .map((providerName) => mcpProvidersByName.get(providerName))
      .flatMap((provider) => (provider ? [cloneMcpProvider(provider)] : [])),
    // biome-ignore lint/style/useNamingConvention: ui schema
    fetched_tools_by_provider: fetchedToolsByProfileName.get(canonical.tool_alias) ?? {},
    // biome-ignore lint/style/useNamingConvention: api schema
    allow_tools: [...(canonical.allow_tools ?? [])],
    // biome-ignore lint/style/useNamingConvention: api schema
    max_tool_call_turns: canonical.max_tool_call_turns ?? "5",
    // biome-ignore lint/style/useNamingConvention: api schema
    timeout_sec: canonical.timeout_sec ?? "",
  };
}

export function importRecipePayload(input: string): ImportResult {
  const parsed = parseJson(input);
  if (!parsed.data || !isRecord(parsed.data)) {
    return {
      errors: [parsed.error ?? "Invalid JSON payload."],
      snapshot: null,
    };
  }

  const recipe = (isRecord(parsed.data.recipe)
    ? parsed.data.recipe
    : parsed.data) as RecipeInput;
  const ui = isRecord(parsed.data.ui) ? (parsed.data.ui as UiInput) : null;

  if (!Array.isArray(recipe.columns)) {
    return { errors: ["Recipe must include columns."], snapshot: null };
  }

  const errors: string[] = [];
  const configs: NodeConfig[] = [];
  const processors = parseProcessors(recipe.processors);
  const mcpProvidersByName = parseMcpProviders(recipe.mcp_providers);
  const toolConfigsByAlias = parseToolConfigs(recipe.tool_configs);
  const nameToId = new Map<string, string>();

  let nextId = 1;
  const uiSeedSourceTypeRaw = readString(ui?.seed_source_type);
  const uiSeedSourceType: SeedSourceType | undefined =
    uiSeedSourceTypeRaw === "hf" ||
    uiSeedSourceTypeRaw === "local" ||
    uiSeedSourceTypeRaw === "unstructured"
      ? uiSeedSourceTypeRaw
      : undefined;
  const uiSeedColumns = Array.isArray(ui?.seed_columns)
    ? ui.seed_columns
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : undefined;
  const uiSeedDropColumns = Array.isArray(ui?.seed_drop_columns)
    ? ui.seed_drop_columns
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : undefined;
  const payloadSeedDropColumns = parseSeedDropColumns(recipe.processors);
  const uiSeedPreviewRows = Array.isArray(ui?.seed_preview_rows)
    ? ui.seed_preview_rows
        .filter((row): row is Record<string, unknown> => isRecord(row))
        .map((row) => ({ ...row }))
    : undefined;
  const uiLocalFileName = readString(ui?.local_file_name) ?? undefined;
  // Preserve file IDs/names from saved recipes (cleared at share time by sanitizeSeedForShare)
  const uiUnstructuredFileIds: string[] = Array.isArray(ui?.unstructured_file_ids)
    ? (ui.unstructured_file_ids as string[]).filter((v): v is string => typeof v === "string")
    : [];
  const uiUnstructuredFileNames: string[] = Array.isArray(ui?.unstructured_file_names)
    ? (ui.unstructured_file_names as string[]).filter((v): v is string => typeof v === "string")
    : [];
  const uiUnstructuredFileSizes: number[] = Array.isArray(ui?.unstructured_file_sizes)
    ? (ui.unstructured_file_sizes as number[]).filter((v): v is number => typeof v === "number")
    : [];
  const uiUnstructuredChunkSize = readStringNumber(ui?.unstructured_chunk_size);
  const uiUnstructuredChunkOverlap = readStringNumber(
    ui?.unstructured_chunk_overlap,
  );
  const uiGsspEnabled =
    typeof ui?.gssp_enabled === "boolean" ? ui.gssp_enabled : undefined;
  const uiGsspEndpoint = readString(ui?.gssp_endpoint) ?? undefined;
  const uiGsspPath = readString(ui?.gssp_path) ?? undefined;
  const uiGsspCorrelationId = readString(ui?.gssp_x_correlation_id) ?? undefined;
  const uiGsspApplicationId = readString(ui?.gssp_x_application_id) ?? undefined;
  const uiGsspSoeid = readString(ui?.gssp_x_soeid) ?? undefined;
  const uiGsspModelName = readString(ui?.gssp_x_model_name) ?? undefined;
  const uiGsspMaxTokens = readString(ui?.gssp_x_max_tokens) ?? undefined;
  const uiGsspAuthorizationCoin =
    readString(ui?.gssp_x_authorization_coin) ?? undefined;
  const uiGsspRequestTemplate =
    readString(ui?.gssp_request_template) ?? undefined;
  const uiAdvancedOpenByNode = parseAdvancedOpenByNode(ui?.advanced_open_by_node);
  const uiToolProfilesByName = parseUiToolProfileNodes(ui?.nodes);

  if (recipe.seed_config) {
    const id = `n${nextId}`;
    nextId += 1;
    const seedConfig = parseSeedConfig(recipe.seed_config, id, {
      preferredSourceType: uiSeedSourceType,
      seed_columns: uiSeedColumns,
      seed_drop_columns:
        uiSeedDropColumns && uiSeedDropColumns.length > 0
          ? uiSeedDropColumns
          : payloadSeedDropColumns,
      seed_preview_rows: uiSeedPreviewRows,
      local_file_name: uiLocalFileName,
      unstructuredFileIds: uiUnstructuredFileIds,
      unstructuredFileNames: uiUnstructuredFileNames,
      unstructuredFileSizes: uiUnstructuredFileSizes,
      unstructured_chunk_size: uiUnstructuredChunkSize,
      unstructured_chunk_overlap: uiUnstructuredChunkOverlap,
      gssp_enabled: uiGsspEnabled,
      gssp_endpoint: uiGsspEndpoint,
      gssp_path: uiGsspPath,
      gssp_x_correlation_id: uiGsspCorrelationId,
      gssp_x_application_id: uiGsspApplicationId,
      gssp_x_soeid: uiGsspSoeid,
      gssp_x_model_name: uiGsspModelName,
      gssp_x_max_tokens: uiGsspMaxTokens,
      gssp_x_authorization_coin: uiGsspAuthorizationCoin,
      gssp_request_template: uiGsspRequestTemplate,
    });
    if (seedConfig) {
      applyAdvancedOpen(seedConfig, uiAdvancedOpenByNode);
      if (nameToId.has(seedConfig.name)) {
        errors.push(`Duplicate column name: ${seedConfig.name}.`);
      } else {
        nameToId.set(seedConfig.name, seedConfig.id);
      }
      configs.push(seedConfig);
    }
  }

  if (Array.isArray(recipe.model_providers)) {
    recipe.model_providers.forEach((provider, index) => {
      if (!isRecord(provider)) {
        errors.push(`Model provider ${index + 1}: invalid object.`);
        return;
      }
      const name = readString(provider.name);
      if (!name) {
        errors.push(`Model provider ${index + 1}: missing name.`);
        return;
      }
      const id = `n${nextId}`;
      nextId += 1;
      const config = parseModelProvider(provider, name, id);
      if (nameToId.has(config.name)) {
        errors.push(`Duplicate column name: ${config.name}.`);
        return;
      }
      nameToId.set(config.name, config.id);
      configs.push(config);
    });
  }

  if (Array.isArray(recipe.model_configs)) {
    recipe.model_configs.forEach((model, index) => {
      if (!isRecord(model)) {
        errors.push(`Model config ${index + 1}: invalid object.`);
        return;
      }
      const name = readString(model.alias) ?? readString(model.name);
      if (!name) {
        errors.push(`Model config ${index + 1}: missing alias.`);
        return;
      }
      const id = `n${nextId}`;
      nextId += 1;
      const config = parseModelConfig(model, name, id);
      if (nameToId.has(config.name)) {
        errors.push(`Duplicate column name: ${config.name}.`);
        return;
      }
      nameToId.set(config.name, config.id);
      configs.push(config);
    });
  }

  for (const toolConfig of toolConfigsByAlias.values()) {
    const id = `n${nextId}`;
    nextId += 1;
    const config = buildToolProfileConfig(
      toolConfig,
      toolConfigsByAlias,
      mcpProvidersByName,
      uiToolProfilesByName,
      id,
    );
    if (nameToId.has(config.name)) {
      errors.push(`Duplicate column name: ${config.name}.`);
      continue;
    }
    nameToId.set(config.name, config.id);
    configs.push(config);
  }

  recipe.columns.forEach((column, index) => {
    if (!isRecord(column)) {
      errors.push(`Column ${index + 1}: invalid object.`);
      return;
    }
    const id = `n${nextId}`;
    nextId += 1;
    const config = parseColumn(column, id, errors);
    if (!config) {
      return;
    }
    applyAdvancedOpen(config, uiAdvancedOpenByNode);
    if (nameToId.has(config.name)) {
      errors.push(`Duplicate column name: ${config.name}.`);
      return;
    }
    nameToId.set(config.name, config.id);
    configs.push(config);
  });

  if (errors.length > 0) {
    return { errors, snapshot: null };
  }

  const { layouts, auxNodes, edges: uiEdges, layoutDirection } = parseUi(ui);
  const resolvedLayoutDirection = layoutDirection ?? "LR";
  const nodes = buildNodes(configs, layouts);
  const edges = buildEdges(
    configs,
    nameToId,
    uiEdges,
    resolvedLayoutDirection,
  );
  const auxNodePositions = Object.fromEntries(
    auxNodes.flatMap((item) => {
      const llmId = nameToId.get(item.llm);
      if (!llmId) {
        return [];
      }
      return [[`aux-${llmId}-${item.key}`, { x: item.x, y: item.y }]];
    }),
  );

  const maxY = nodes.reduce(
    (acc, node) => Math.max(acc, node.position.y),
    0,
  );

  return {
    errors: [],
    snapshot: {
      configs: Object.fromEntries(configs.map((config) => [config.id, config])),
      nodes,
      edges,
      auxNodePositions,
      processors,
      layoutDirection: resolvedLayoutDirection,
      nextId,
      nextY: maxY + 140,
    },
  };
}
