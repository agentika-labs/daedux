import {
  ArrowRight01Icon,
  Folder01Icon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  AgentConfigFile,
  AgentHarnessConfig,
  AgentHarnessConfigId,
  AgentSkillEntry,
} from "@shared/rpc-types";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useAgentHarnessesQuery,
  useCopyAgentSkillMutation,
  useUpdateAgentConfigMutation,
} from "@/queries/agent-harnesses";
import { isElectrobun } from "@/services/api-live";

const DEFAULT_HARNESS_ID: AgentHarnessConfigId = "claude-code";

const EMPTY_HARNESSES: AgentHarnessConfig[] = [];
const EMPTY_SKILLS: AgentSkillEntry[] = [];

const formatFileMeta = (file: AgentConfigFile): string => {
  if (!file.exists) {
    return "Not created";
  }

  const size = file.sizeBytes === null ? "Unknown size" : `${file.sizeBytes} B`;
  const updatedAt =
    file.updatedAt === null
      ? "unknown"
      : new Date(file.updatedAt).toLocaleString();
  return `${size} • ${updatedAt}`;
};

export function AgentHarnessesScreen() {
  const desktopAvailable = isElectrobun();
  const { data, isPending, error, refetch } = useAgentHarnessesQuery();
  const [selectedHarnessId, setSelectedHarnessId] =
    useState<AgentHarnessConfigId>(DEFAULT_HARNESS_ID);
  const [selectedFileId, setSelectedFileId] = useState("");

  const harnesses = data?.harnesses ?? EMPTY_HARNESSES;
  const selectedHarness = useMemo(
    () =>
      harnesses.find((harness) => harness.id === selectedHarnessId) ??
      harnesses[0] ??
      null,
    [harnesses, selectedHarnessId]
  );
  const selectedFile =
    selectedHarness?.configFiles.find((file) => file.id === selectedFileId) ??
    selectedHarness?.configFiles[0] ??
    null;

  if (!desktopAvailable) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Agent Harnesses</CardTitle>
            <CardDescription>
              Local harness configuration is available in the desktop app.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent Harnesses</h1>
          <p className="text-muted-foreground text-sm">
            Inspect local agent configs and copy skills between installed
            harnesses.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetch();
          }}
          disabled={isPending}
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            className={cn("size-4", isPending && "animate-spin")}
            data-icon="inline-start"
          />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-destructive text-sm">{error.message}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <HarnessList
            harnesses={harnesses}
            selectedHarnessId={selectedHarness?.id ?? DEFAULT_HARNESS_ID}
            loading={isPending}
            onSelectHarness={(harnessId) => {
              setSelectedHarnessId(harnessId);
              setSelectedFileId("");
            }}
          />

          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <ConfigPanel
              harness={selectedHarness}
              selectedFile={selectedFile}
              selectedFileId={selectedFile?.id ?? ""}
              onSelectFile={setSelectedFileId}
              loading={isPending}
            />
            <SkillTransferPanel harnesses={harnesses} loading={isPending} />
          </div>
        </div>
      )}
    </main>
  );
}

interface HarnessListProps {
  harnesses: AgentHarnessConfig[];
  selectedHarnessId: AgentHarnessConfigId;
  loading: boolean;
  onSelectHarness: (harnessId: AgentHarnessConfigId) => void;
}

function HarnessList({
  harnesses,
  selectedHarnessId,
  loading,
  onSelectHarness,
}: HarnessListProps) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Detected Harnesses</CardTitle>
        <CardDescription>
          Known local config roots under your home directory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && harnesses.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Scanning local harnesses...
          </p>
        ) : (
          harnesses.map((harness) => (
            <button
              key={harness.id}
              type="button"
              onClick={() => {
                onSelectHarness(harness.id);
              }}
              className={cn(
                "border-border bg-background hover:bg-muted/70 flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                selectedHarnessId === harness.id && "border-primary bg-muted"
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {harness.label}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {harness.rootPath}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={harness.exists ? "success" : "outline"}>
                  {harness.exists ? "Found" : "Missing"}
                </Badge>
                <Badge variant="secondary">{harness.skills.length}</Badge>
              </span>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

interface ConfigPanelProps {
  harness: AgentHarnessConfig | null;
  selectedFile: AgentConfigFile | null;
  selectedFileId: string;
  loading: boolean;
  onSelectFile: (fileId: string) => void;
}

function ConfigPanel({
  harness,
  selectedFile,
  selectedFileId,
  loading,
  onSelectFile,
}: ConfigPanelProps) {
  if (loading && !harness) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-sm">
            Loading config files...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!harness || !selectedFile) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-sm">
            No harnesses detected.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{harness.label} Config</CardTitle>
            <CardDescription className="break-all">
              {harness.rootPath}
            </CardDescription>
          </div>
          <Select
            value={selectedFileId}
            onValueChange={(value) => value && onSelectFile(value)}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue>{selectedFile.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {harness.configFiles.map((file) => (
                <SelectItem key={file.id} value={file.id}>
                  {file.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ConfigEditor
          key={`${harness.id}:${selectedFile.id}:${selectedFile.updatedAt ?? "missing"}`}
          harnessId={harness.id}
          file={selectedFile}
        />
      </CardContent>
    </Card>
  );
}

interface ConfigEditorProps {
  harnessId: AgentHarnessConfigId;
  file: AgentConfigFile;
}

function ConfigEditor({ harnessId, file }: ConfigEditorProps) {
  const [draft, setDraft] = useState(file.content);
  const updateMutation = useUpdateAgentConfigMutation();
  const isDirty = draft !== file.content;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Folder01Icon}
              className="text-muted-foreground size-4"
            />
            <p className="truncate text-sm font-medium">{file.relativePath}</p>
            <Badge variant={file.exists ? "secondary" : "outline"}>
              {file.exists ? "Existing" : "New"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 break-all text-xs">
            {file.path}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {formatFileMeta(file)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(file.content);
            }}
            disabled={!isDirty || updateMutation.isPending}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => {
              updateMutation.mutate({
                content: draft,
                harnessId,
                path: file.path,
              });
            }}
            disabled={!isDirty || file.readOnly || updateMutation.isPending}
          >
            <HugeiconsIcon
              icon={Tick02Icon}
              className="size-4"
              data-icon="inline-start"
            />
            Save
          </Button>
        </div>
      </div>

      {file.error && <p className="text-destructive text-sm">{file.error}</p>}
      {updateMutation.error && (
        <p className="text-destructive text-sm">
          {updateMutation.error.message}
        </p>
      )}
      {updateMutation.isSuccess && !isDirty && (
        <p className="text-success text-sm">Saved {file.relativePath}.</p>
      )}

      <Textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        disabled={file.readOnly || updateMutation.isPending}
        spellCheck={false}
        className="min-h-[520px] resize-y font-mono text-sm leading-6"
        placeholder="Create this config file from Daedux."
      />
    </div>
  );
}

interface SkillTransferPanelProps {
  harnesses: AgentHarnessConfig[];
  loading: boolean;
}

function SkillTransferPanel({ harnesses, loading }: SkillTransferPanelProps) {
  const [sourceHarnessId, setSourceHarnessId] =
    useState<AgentHarnessConfigId>(DEFAULT_HARNESS_ID);
  const [targetHarnessId, setTargetHarnessId] =
    useState<AgentHarnessConfigId>("codex");
  const [selectedSkillPath, setSelectedSkillPath] = useState("");
  const copyMutation = useCopyAgentSkillMutation();

  const sourceHarness =
    harnesses.find((harness) => harness.id === sourceHarnessId) ??
    harnesses[0] ??
    null;
  const targetHarness =
    harnesses.find((harness) => harness.id === targetHarnessId) ??
    harnesses.find((harness) => harness.id !== sourceHarness?.id) ??
    null;
  const sourceSkills = sourceHarness?.skills ?? EMPTY_SKILLS;
  const selectedSkill =
    sourceSkills.find((skill) => skill.path === selectedSkillPath) ??
    sourceSkills[0] ??
    null;
  const targetIsSource = sourceHarness?.id === targetHarness?.id;
  const canCopy = Boolean(selectedSkill && targetHarness && !targetIsSource);

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Share Skills</CardTitle>
        <CardDescription>
          Copy a local skill folder into another harness.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && harnesses.length === 0 ? (
          <p className="text-muted-foreground text-sm">Loading skills...</p>
        ) : (
          <>
            <Field label="From">
              <HarnessSelect
                harnesses={harnesses}
                value={sourceHarness?.id ?? DEFAULT_HARNESS_ID}
                onChange={(harnessId) => {
                  setSourceHarnessId(harnessId);
                  setSelectedSkillPath("");
                }}
              />
            </Field>

            <Field label="Skill">
              <Select
                value={selectedSkill?.path ?? ""}
                onValueChange={(value) => {
                  setSelectedSkillPath(value ?? "");
                }}
                disabled={sourceSkills.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {selectedSkill?.displayName ?? "No skills found"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sourceSkills.map((skill) => (
                    <SelectItem key={skill.path} value={skill.path}>
                      {skill.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSkill && (
                <p className="text-muted-foreground break-all text-xs">
                  {selectedSkill.description ?? selectedSkill.path}
                </p>
              )}
            </Field>

            <div className="flex justify-center">
              <div className="bg-muted flex size-9 items-center justify-center rounded-full">
                <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
              </div>
            </div>

            <Field label="To">
              <HarnessSelect
                harnesses={harnesses}
                value={targetHarness?.id ?? "codex"}
                onChange={setTargetHarnessId}
              />
              {targetHarness && (
                <p className="text-muted-foreground break-all text-xs">
                  {targetHarness.skillPath}
                </p>
              )}
            </Field>

            {targetIsSource && (
              <p className="text-destructive text-sm">
                Choose a different target harness.
              </p>
            )}
            {copyMutation.error && (
              <p className="text-destructive text-sm">
                {copyMutation.error.message}
              </p>
            )}
            {copyMutation.data && (
              <p
                className={cn(
                  "text-sm",
                  copyMutation.data.status === "copied"
                    ? "text-success"
                    : "text-muted-foreground"
                )}
              >
                {copyMutation.data.message}
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => {
                if (selectedSkill && targetHarness) {
                  copyMutation.mutate({
                    sourcePath: selectedSkill.path,
                    targetHarnessId: targetHarness.id,
                  });
                }
              }}
              disabled={!canCopy || copyMutation.isPending}
            >
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="size-4"
                data-icon="inline-start"
              />
              Copy Skill
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

interface HarnessSelectProps {
  harnesses: AgentHarnessConfig[];
  value: AgentHarnessConfigId;
  onChange: (harnessId: AgentHarnessConfigId) => void;
}

function HarnessSelect({ harnesses, value, onChange }: HarnessSelectProps) {
  const selectedHarness = harnesses.find((harness) => harness.id === value);

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue as AgentHarnessConfigId);
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>{selectedHarness?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {harnesses.map((harness) => (
          <SelectItem key={harness.id} value={harness.id}>
            {harness.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
