import path from 'path';

function doctorCommand(context, options, helpers) {
  const { summarizeState, summarizePaths, isInitialized } = helpers;

  return {
    app: context.appRoot,
    initialized: isInitialized(context),
    paths: summarizePaths(context),
    state: isInitialized(context) ? summarizeState(context, helpers.readJson) : null,
    mode: options.mode || 'cli',
  };
}

function installCodexCommand(context, options, helpers) {
  const {
    ensureDir,
    writeJson,
    writeText,
    resolveCodexHome,
    normalizeCodexInstallMode,
    buildCodexInstallPlan,
    buildCodexPluginManifest,
    buildCodexPluginReadme,
    buildCodexSkillMarkdown,
    buildCodexSkillOpenAiYaml,
    resolveCodexIntegrationDefinition,
    packageVersion,
  } = helpers;

  const integration = options.integration || 'entro-distill';
  const definition = resolveCodexIntegrationDefinition
    ? resolveCodexIntegrationDefinition(integration)
    : null;
  const codexHome = resolveCodexHome();
  const mode = normalizeCodexInstallMode(options.mode);
  const skillName = options.skill || definition?.skillName || 'entro-distill';
  const plan = buildCodexInstallPlan({
    codexHome,
    skillName,
    pluginName: options.plugin || 'entro',
  });
  const skillMarkdown = buildCodexSkillMarkdown({
    skillName: plan.skillName,
    title: definition?.title,
    description: definition?.description,
    body: definition?.markdownBody,
  });
  const skillOpenAiYaml = buildCodexSkillOpenAiYaml({
    displayName: definition?.displayName,
    shortDescription: definition?.shortDescription,
    defaultPrompt: definition?.defaultPrompt,
  });

  if (mode === 'skill' || mode === 'both') {
    ensureDir(plan.skillDir);
    ensureDir(path.join(plan.skillDir, 'agents'));
    writeText(path.join(plan.skillDir, 'SKILL.md'), skillMarkdown);
    writeText(path.join(plan.skillDir, 'agents', 'openai.yaml'), skillOpenAiYaml);
  }

  if (mode === 'plugin' || mode === 'both') {
    ensureDir(plan.pluginDir);
    ensureDir(path.join(plan.pluginDir, '.codex-plugin'));
    ensureDir(plan.pluginSkillDir);
    ensureDir(path.join(plan.pluginSkillDir, 'agents'));
    writeJson(
      plan.pluginManifestPath,
      buildCodexPluginManifest({
        version: packageVersion,
        pluginName: plan.pluginName,
        skillName: plan.skillName,
        displayName: definition?.pluginDisplayName,
        shortDescription: definition?.pluginShortDescription,
        longDescription: definition?.pluginLongDescription,
        defaultPrompt: definition?.defaultPrompt,
      }),
    );
    writeText(plan.pluginReadmePath, buildCodexPluginReadme({ skillName: plan.skillName }));
    writeText(path.join(plan.pluginSkillDir, 'SKILL.md'), skillMarkdown);
    writeText(path.join(plan.pluginSkillDir, 'agents', 'openai.yaml'), skillOpenAiYaml);
  }

  return {
    codexHome,
    mode,
    integration,
    installed: {
      skill: mode === 'skill' || mode === 'both'
        ? {
            name: plan.skillName,
            path: plan.skillDir,
          }
        : null,
      plugin: mode === 'plugin' || mode === 'both'
        ? {
            name: plan.pluginName,
            path: plan.pluginDir,
            manifest: plan.pluginManifestPath,
          }
        : null,
    },
  };
}

export {
  doctorCommand,
  installCodexCommand,
};
