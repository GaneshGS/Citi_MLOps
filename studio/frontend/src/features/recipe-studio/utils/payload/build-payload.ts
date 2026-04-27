// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import type { Edge, XYPosition } from "@xyflow/react";
import type {
  LayoutDirection,
  ModelConfig,
  ModelProviderConfig,
  NodeConfig,
  RecipeNode,
  RecipeProcessorConfig,
} from "../../types";
import { isSemanticRelation } from "../graph/relations";
import { getConfigErrors } from "../index";
import {
  getDefaultDataSourceHandle,
  getDefaultDataTargetHandle,
  getDefaultSemanticSourceHandle,
  getDefaultSemanticTargetHandle,
  isDataSourceHandle,
  isDataTargetHandle,
  isSemanticSourceHandle,
  isSemanticTargetHandle,
  normalizeRecipeHandleId,
} from "../handles";
import { readNodeWidth } from "../rf-node-dimensions";
import {
  buildExpressionColumn,
  buildLlmColumn,
  buildModelConfig,
  buildModelProvider,
  buildProcessors,
  buildSamplerColumn,
  buildSeedConfig,
  buildSeedDropProcessor,
  buildToolProfilePayload,
  buildValidatorColumn,
  pickFirstSeedConfig,
} from "./builders";
import type { RecipePayloadResult } from "./types";
import {
  validateModelAliasLinks,
  validateModelConfigProviders,
  validateSubcategoryConfigs,
  validateTimedeltaConfigs,
  validateValidatorConfigs,
  validateUsedProviders,
} from "./validate";
import { isLikelyImageValue } from "../image-preview";

function pushUniqueJson(
  label: string,
  key: string,
  item: Record<string, unknown>,
  seen: Map<string, string>,
  out: Record<string, unknown>[],
  errors: string[],
): void {
  const serialized = JSON.stringify(item);
  const existing = seen.get(key);
  if (existing && existing !== serialized) {
    errors.push(`${label} ${key}: conflicting definitions.`);
    return;
  }
  if (!existing) {
    seen.set(key, serialized);
    out.push(item);
  }
}

function collectAdvancedOpenByNode(
  configs: Record<string, NodeConfig>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const config of Object.values(configs)) {
    if (
      !(
        config.kind === "sampler" ||
        config.kind === "llm" ||
        config.kind === "validator" ||
        config.kind === "seed"
      )
    ) {
      continue;
    }
    if (config.advancedOpen !== true) {
      continue;
    }
    out[config.name] = true;
  }
  return out;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: payload build
export function buildRecipePayload(
  configs: Record<string, NodeConfig>,
  nodes: RecipeNode[],
  edges: Edge[],
  processors: RecipeProcessorConfig[] = [],
  layoutDirection: LayoutDirection = "LR",
  auxNodePositions: Record<string, XYPosition> = {},
): RecipePayloadResult {
  const errors: string[] = [];
  const columns: Record<string, unknown>[] = [];
  const modelAliases = new Set<string>();
  const modelProviderNames = new Set<string>();
  const localProviderNames = new Set<string>();
  const modelProviders: Record<string, unknown>[] = [];
  const mcpProviders: Record<string, unknown>[] = [];
  const modelConfigs: Record<string, unknown>[] = [];
  const toolConfigs: Record<string, unknown>[] = [];
  const modelProviderConfigs: ModelProviderConfig[] = [];
  const modelConfigConfigs: ModelConfig[] = [];
  const llmToolAliasesUsed = new Set<string>();
  const mcpProviderJsonByName = new Map<string, string>();
  const toolConfigJsonByAlias = new Map<string, string>();
  const nameSet = new Set<string>();
  const nameToConfig = new Map<string, NodeConfig>();
  const allNameToConfig = new Map<string, NodeConfig>();
  const firstSeed = pickFirstSeedConfig(configs);
  const gsspMode = Boolean(firstSeed?.gssp_enabled);

  for (const config of Object.values(configs)) {
    if (config.kind === "seed") {
      continue;
    }
    allNameToConfig.set(config.name, config);
  }

  for (const node of nodes) {
    const config = configs[node.id];
    if (!config) {
      continue;
    }
    for (const error of getConfigErrors(config)) {
      errors.push(`${config.name}: ${error}`);
    }
    if (config.kind !== "seed") {
      if (nameSet.has(config.name)) {
        errors.push(`Duplicate node name: ${config.name}.`);
      }
      nameSet.add(config.name);
    }

    if (config.kind === "sampler") {
      nameToConfig.set(config.name, config);
      columns.push(buildSamplerColumn(config, errors));
      continue;
    }
    if (config.kind === "llm") {
      if (config.image_context?.enabled) {
        const imageContext = config.image_context;
        const columnName = imageContext.column_name.trim();
        if (columnName) {
          if (firstSeed?.seed_columns && firstSeed.seed_columns.length > 0) {
            if (!firstSeed.seed_columns.includes(columnName)) {
              errors.push(
                `LLM ${config.name}: image context column '${columnName}' not found in seed columns.`,
              );
            }
          }
          const previewRows = firstSeed?.seed_preview_rows ?? [];
          if (previewRows.length > 0) {
            const hasImageLikeValue = previewRows.some((row) =>
              isLikelyImageValue(row[columnName]),
            );
            if (!hasImageLikeValue) {
              errors.push(
                `LLM ${config.name}: image context column '${columnName}' has no image-like values in preview rows.`,
              );
            }
          }
        }
      }
      const llmColumn = buildLlmColumn(config, errors) as Record<string, unknown>;
      if (gsspMode) {
        llmColumn.model_alias = "gssp_default";
        // Prompt and response schema for GSSP PDF QA are applied on the server only.
        delete llmColumn.prompt;
        delete llmColumn.output_format;
      }
      columns.push(llmColumn);
      if (config.model_alias || gsspMode) {
        modelAliases.add(gsspMode ? "gssp_default" : config.model_alias);
      }
      const toolAlias = config.tool_alias?.trim();
      if (toolAlias) {
        llmToolAliasesUsed.add(toolAlias);
      }
      nameToConfig.set(config.name, config);
      continue;
    }
    if (config.kind === "expression") {
      columns.push(buildExpressionColumn(config, errors));
      nameToConfig.set(config.name, config);
      continue;
    }
    if (config.kind === "validator") {
      columns.push(buildValidatorColumn(config, errors, allNameToConfig));
      nameToConfig.set(config.name, config);
      continue;
    }
    if (config.kind === "seed") {
      // SeedConfig is global config (seed_config); seed-dataset columns are added by DataDesigner.
      continue;
    }
    if (config.kind === "markdown_note") {
      continue;
    }
    if (config.kind === "model_provider") {
      modelProviderNames.add(config.name);
      if (config.is_local) {
        localProviderNames.add(config.name);
      }
      modelProviders.push(buildModelProvider(config, errors));
      modelProviderConfigs.push(config);
      continue;
    }
    if (config.kind === "tool_config") {
      const built = buildToolProfilePayload(config, errors);
      for (const provider of built.mcp_providers) {
        pushUniqueJson(
          "MCP provider",
          String(provider.name),
          provider,
          mcpProviderJsonByName,
          mcpProviders,
          errors,
        );
      }
      if (built.tool_config) {
        pushUniqueJson(
          "Tool config",
          String(built.tool_config.tool_alias),
          built.tool_config,
          toolConfigJsonByAlias,
          toolConfigs,
          errors,
        );
      }
      continue;
    }
    modelConfigs.push(buildModelConfig(config, errors));
    modelConfigConfigs.push(config);
  }

  validateSubcategoryConfigs(configs, nameToConfig, errors);
  validateTimedeltaConfigs(configs, nameToConfig, errors);
  validateValidatorConfigs(configs, nameToConfig, errors);
  if (!gsspMode) {
    validateModelAliasLinks(modelAliases, modelConfigConfigs, errors);
    validateModelConfigProviders(
      modelConfigConfigs,
      modelAliases,
      modelProviderNames,
      localProviderNames,
      errors,
    );
    validateUsedProviders(modelProviderConfigs, modelConfigConfigs, errors);
  }
  for (const toolAlias of llmToolAliasesUsed) {
    if (!toolConfigJsonByAlias.has(toolAlias)) {
      errors.push(`Tool alias ${toolAlias}: missing tool config.`);
    }
  }

  const uiNodes = nodes.flatMap((node) => {
    const config = configs[node.id];
    if (!config) {
      return [];
    }
    const width = readNodeWidth(node);
    if (config.kind === "markdown_note") {
      return [
        {
          id: config.name,
          x: node.position.x,
          y: node.position.y,
          ...(width !== null ? { width } : {}),
          node_type: "markdown_note" as const,
          name: config.name,
          markdown: config.markdown,
          note_color: config.note_color,
          note_opacity: config.note_opacity,
        },
      ];
    }
    if (config.kind === "tool_config") {
      const toolsByProvider = Object.fromEntries(
        Object.entries(config.fetched_tools_by_provider ?? {}).flatMap(
          ([providerName, tools]) => {
            const name = providerName.trim();
            const values = Array.from(
              new Set(tools.map((tool) => tool.trim()).filter(Boolean)),
            );
            return name && values.length > 0 ? [[name, values]] : [];
          },
        ),
      );
      return [
        {
          id: config.name,
          x: node.position.x,
          y: node.position.y,
          ...(width !== null ? { width } : {}),
          node_type: "tool_config" as const,
          ...(Object.keys(toolsByProvider).length > 0 && {
            tools_by_provider: toolsByProvider,
          }),
        },
      ];
    }
    return [
      {
        id: config.name,
        x: node.position.x,
        y: node.position.y,
        ...(width !== null ? { width } : {}),
      },
    ];
  });

  const uiEdges = edges.flatMap((edge) => {
    const source = edge.source ? configs[edge.source] : null;
    const target = edge.target ? configs[edge.target] : null;
    if (!(source && target)) {
      return [];
    }
    if (source.kind === "markdown_note" || target.kind === "markdown_note") {
      return [];
    }
    const semantic =
      edge.type === "semantic" || isSemanticRelation(source, target);
    const sourceHandleNormalized = normalizeRecipeHandleId(edge.sourceHandle);
    const targetHandleNormalized = normalizeRecipeHandleId(edge.targetHandle);
    const semanticSourceDefault =
      source.kind === "llm"
        ? getDefaultDataSourceHandle(layoutDirection)
        : getDefaultSemanticSourceHandle(layoutDirection);
    const semanticTargetDefault =
      target.kind === "llm"
        ? getDefaultDataTargetHandle(layoutDirection)
        : getDefaultSemanticTargetHandle(layoutDirection);
    let sourceHandle = getDefaultDataSourceHandle(layoutDirection);
    let targetHandle = getDefaultDataTargetHandle(layoutDirection);

    if (semantic) {
      sourceHandle =
        isSemanticSourceHandle(sourceHandleNormalized) ||
        isDataSourceHandle(sourceHandleNormalized)
          ? sourceHandleNormalized ?? semanticSourceDefault
          : semanticSourceDefault;
      targetHandle =
        isSemanticTargetHandle(targetHandleNormalized) ||
        isDataTargetHandle(targetHandleNormalized)
          ? targetHandleNormalized ?? semanticTargetDefault
          : semanticTargetDefault;
    } else {
      sourceHandle = isDataSourceHandle(sourceHandleNormalized)
        ? sourceHandleNormalized ?? getDefaultDataSourceHandle(layoutDirection)
        : getDefaultDataSourceHandle(layoutDirection);
      targetHandle = isDataTargetHandle(targetHandleNormalized)
        ? targetHandleNormalized ?? getDefaultDataTargetHandle(layoutDirection)
        : getDefaultDataTargetHandle(layoutDirection);
    }
    return [
      {
        from: source.name,
        to: target.name,
        type: semantic ? "semantic" : "canvas",
        source_handle: sourceHandle ?? undefined,
        target_handle: targetHandle ?? undefined,
      },
    ];
  });
  const uiAuxNodes = Object.entries(auxNodePositions).flatMap(
    ([auxId, position]) => {
      const match = /^aux-([^-]+)-(.+)$/.exec(auxId);
      if (!match) {
        return [];
      }
      const [, llmId, key] = match;
      const llmConfig = configs[llmId];
      if (!(llmConfig && llmConfig.kind === "llm")) {
        return [];
      }
      return [
        {
          llm: llmConfig.name,
          key,
          x: position.x,
          y: position.y,
        },
      ];
    },
  );
  const recipeProcessors = buildProcessors(processors, errors);
  const seedConfig = firstSeed ? buildSeedConfig(firstSeed, errors) : undefined;
  const effectiveModelProviders = [...modelProviders];
  const effectiveModelConfigs = [...modelConfigs];
  if (gsspMode) {
    const gsspPath =
      "/api/gssp-generation-service/v1/generate-pass-through";
    effectiveModelProviders.length = 0;
    effectiveModelConfigs.length = 0;
    effectiveModelProviders.push({
      name: "gssp_provider",
      // Base URL, path, auth, pass-through headers, and optional request template
      // are applied server-side (gssp_dummy.apply_gssp_server_provider_config).
      endpoint: "",
      // biome-ignore lint/style/useNamingConvention: api schema
      provider_type: "openai",
      // biome-ignore lint/style/useNamingConvention: api schema
      api_key: undefined,
      // biome-ignore lint/style/useNamingConvention: api schema
      extra_body: {
        gssp_path: gsspPath,
      },
      // biome-ignore lint/style/useNamingConvention: api schema
      extra_headers: {},
    });
    effectiveModelConfigs.push({
      alias: "gssp_default",
      model: "gssp-pass-through",
      provider: "gssp_provider",
      // biome-ignore lint/style/useNamingConvention: api schema
      skip_health_check: true,
    });
  }
  const seedDropProcessor = firstSeed
    ? buildSeedDropProcessor(firstSeed, errors)
    : null;
  if (seedDropProcessor) {
    recipeProcessors.push(seedDropProcessor);
  }
  const uiAdvancedOpenByNode = collectAdvancedOpenByNode(configs);

  return {
    errors,
    payload: {
      recipe: {
        // biome-ignore lint/style/useNamingConvention: api schema
        model_providers: effectiveModelProviders,
        // biome-ignore lint/style/useNamingConvention: api schema
        mcp_providers: mcpProviders,
        // biome-ignore lint/style/useNamingConvention: api schema
        model_configs: effectiveModelConfigs,
        // biome-ignore lint/style/useNamingConvention: api schema
        seed_config: seedConfig,
        // biome-ignore lint/style/useNamingConvention: api schema
        tool_configs: toolConfigs,
        columns,
        processors: recipeProcessors,
      },
      run: {
        rows: 5,
        preview: true,
        // biome-ignore lint/style/useNamingConvention: api schema
        output_formats: ["jsonl"],
      },
      ui: {
        nodes: uiNodes,
        edges: uiEdges,
        layout_direction: layoutDirection,
        ...(uiAuxNodes.length > 0 && { aux_nodes: uiAuxNodes }),
        ...(firstSeed && { seed_source_type: firstSeed.seed_source_type }),
        ...(firstSeed && { seed_columns: firstSeed.seed_columns ?? [] }),
        ...(firstSeed && {
          seed_drop_columns: firstSeed.seed_drop_columns ?? [],
        }),
        ...(firstSeed && {
          seed_preview_rows: firstSeed.seed_preview_rows ?? [],
        }),
        ...(firstSeed &&
          firstSeed.local_file_name !== undefined && {
            local_file_name: firstSeed.local_file_name,
          }),
        ...(firstSeed &&
          firstSeed.unstructured_file_ids !== undefined && {
            unstructured_file_ids: firstSeed.unstructured_file_ids,
            unstructured_file_names: firstSeed.unstructured_file_names,
            unstructured_file_sizes: firstSeed.unstructured_file_sizes,
          }),
        ...(firstSeed &&
          firstSeed.unstructured_chunk_size !== undefined && {
            unstructured_chunk_size: firstSeed.unstructured_chunk_size,
          }),
        ...(firstSeed &&
          firstSeed.unstructured_chunk_overlap !== undefined && {
            unstructured_chunk_overlap: firstSeed.unstructured_chunk_overlap,
          }),
        ...(firstSeed &&
          firstSeed.gssp_enabled !== undefined && {
            gssp_enabled: firstSeed.gssp_enabled,
          }),
        ...(Object.keys(uiAdvancedOpenByNode).length > 0 && {
          // biome-ignore lint/style/useNamingConvention: ui schema
          advanced_open_by_node: uiAdvancedOpenByNode,
        }),
      },
    },
  };
}
