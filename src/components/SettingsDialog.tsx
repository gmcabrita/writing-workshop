import { useLiveQuery } from "dexie-react-hooks";
import { Effect } from "effect";
import { Loader2Icon, PlugZapIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { LlmClient } from "@/llm/LlmClient";
import { runtime } from "@/runtime";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/db/database";
import {
  createPassPrompt,
  deletePassPrompt,
  restoreDefaultPassPrompts,
  saveLlmConfig,
  saveSystemPrompt,
  updatePassPrompt,
} from "@/db/repo";
import {
  DEFAULT_SYSTEM_PROMPT,
  RESPONSE_FORMAT_INSTRUCTIONS,
  type LlmConfig,
  type PassPrompt,
  type Settings,
} from "@/domain/model";

export interface SettingsDialogProps {
  onOpenChange(open: boolean): void;
  readonly open: boolean;
  readonly settings: Settings;
}

type ConnectionTest =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "ok"; readonly ms: number; readonly reply: string }
  | { readonly kind: "failed"; readonly message: string };

/** One tiny completion against the draft config, with a 30 second cap. */
const testConnection = (config: LlmConfig): Effect.Effect<ConnectionTest, never, LlmClient> =>
  Effect.gen(function* () {
    const client = yield* LlmClient;
    const started = Date.now();

    const reply = yield* client.complete({ ...config, jsonMode: false }, [
      { content: "Reply with the single word OK.", role: "user" },
    ]);

    return { kind: "ok", ms: Date.now() - started, reply: reply.trim().slice(0, 80) } as const;
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.succeed({ kind: "failed", message: "No reply within 30 seconds." } as const),
    ),
    Effect.catchTag("LlmError", (error) =>
      Effect.succeed({ kind: "failed", message: error.message } as const),
    ),
  );

const ConnectionTestResult = ({ result }: { readonly result: ConnectionTest }) => {
  if (result.kind === "ok") {
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-400">
        Connected in {result.ms} ms. Reply: “{result.reply}”
      </span>
    );
  }

  if (result.kind === "failed") {
    return <span className="text-xs text-destructive">{result.message}</span>;
  }

  return null;
};

const ConnectionTab = ({ llm }: { readonly llm: LlmConfig }) => {
  const [draft, setDraft] = useState<LlmConfig>(llm);
  const [test, setTest] = useState<ConnectionTest>({ kind: "idle" });

  const runTest = async () => {
    setTest({ kind: "running" });
    setTest(await runtime.runPromise(testConnection(draft)));
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(llm);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="llm-base-url">Base URL</Label>
        <Input
          id="llm-base-url"
          onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
          placeholder="https://api.openai.com/v1"
          value={draft.baseUrl}
        />
        <p className="text-xs text-muted-foreground">
          Any OpenAI-compatible server. <code>/chat/completions</code> is appended.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="llm-api-key">API key</Label>
        <Input
          autoComplete="off"
          id="llm-api-key"
          onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
          type="password"
          value={draft.apiKey}
        />
        <p className="text-xs text-muted-foreground">
          Stored only in this browser&apos;s IndexedDB. Leave empty for servers without auth.
        </p>
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="llm-model">Model</Label>
          <Input
            id="llm-model"
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            value={draft.model}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="llm-temperature">Temperature</Label>
          <Input
            id="llm-temperature"
            max={2}
            min={0}
            onChange={(event) => {
              const value = Number.parseFloat(event.target.value);

              if (Number.isFinite(value)) {
                setDraft({ ...draft, temperature: value });
              }
            }}
            step={0.1}
            type="number"
            value={draft.temperature}
          />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label htmlFor="llm-json-mode">JSON mode</Label>
          <p className="text-xs text-muted-foreground">
            Send <code>response_format: json_object</code>. Turn off for servers that reject it.
          </p>
        </div>
        <Switch
          checked={draft.jsonMode}
          id="llm-json-mode"
          onCheckedChange={(checked) => setDraft({ ...draft, jsonMode: checked })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            disabled={test.kind === "running"}
            onClick={() => void runTest()}
            size="sm"
            variant="outline"
          >
            {test.kind === "running" ? <Loader2Icon className="animate-spin" /> : <PlugZapIcon />}
            Test connection
          </Button>
          <ConnectionTestResult result={test} />
        </div>
        <Button disabled={!dirty} onClick={() => void saveLlmConfig(draft)}>
          Save connection
        </Button>
      </div>
    </div>
  );
};

const SystemPromptTab = ({ systemPrompt }: { readonly systemPrompt: string }) => {
  const [draft, setDraft] = useState(systemPrompt);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Sent as the system message for every pass. It should describe the editor&apos;s role and the
        JSON format the app expects.
      </p>
      <Textarea
        className="min-h-72 font-mono text-xs"
        onChange={(event) => setDraft(event.target.value)}
        value={draft}
      />
      <details className="rounded-md border bg-muted/40 p-3 text-xs">
        <summary className="cursor-pointer font-medium">Appended output format</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-muted-foreground">
          {RESPONSE_FORMAT_INSTRUCTIONS}
        </pre>
      </details>
      <div className="flex justify-between">
        <Button onClick={() => setDraft(DEFAULT_SYSTEM_PROMPT)} variant="ghost">
          Reset to default
        </Button>
        <Button disabled={draft === systemPrompt} onClick={() => void saveSystemPrompt(draft)}>
          Save system prompt
        </Button>
      </div>
    </div>
  );
};

const PassPromptEditor = ({ passPrompt }: { readonly passPrompt: PassPrompt }) => {
  const [name, setName] = useState(passPrompt.name);
  const [prompt, setPrompt] = useState(passPrompt.prompt);

  const dirty = name !== passPrompt.name || prompt !== passPrompt.prompt;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Pass name"
          className="h-8 font-medium"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <Button
          aria-label="Delete pass prompt"
          onClick={() => void deletePassPrompt(passPrompt.id)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      <Textarea
        aria-label="Pass prompt"
        className="min-h-24 text-sm"
        onChange={(event) => setPrompt(event.target.value)}
        value={prompt}
      />
      {dirty ? (
        <div className="flex justify-end">
          <Button onClick={() => void updatePassPrompt(passPrompt.id, name, prompt)} size="sm">
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const PassPromptsTab = () => {
  const prompts = useLiveQuery(() => db.passPrompts.orderBy("order").toArray(), []) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Each pass has its own instructions, sent with the system prompt when you run it. The
        defaults follow Williams&apos; <em>Style: Lessons in Clarity and Grace</em>, ordered from
        large problems to small.
      </p>
      {prompts.map((passPrompt) => (
        <PassPromptEditor
          key={`${passPrompt.id}:${passPrompt.name}:${passPrompt.prompt}`}
          passPrompt={passPrompt}
        />
      ))}
      <div className="flex items-center justify-between">
        <Button
          onClick={() =>
            void createPassPrompt("New pass", "Describe what this pass should look for.")
          }
          variant="outline"
        >
          <PlusIcon />
          Add pass
        </Button>
        <Button
          onClick={() => {
            if (window.confirm("Replace all pass prompts with the built-in set?")) {
              void restoreDefaultPassPrompts();
            }
          }}
          variant="ghost"
        >
          Restore defaults
        </Button>
      </div>
    </div>
  );
};

/**
 * Each tab keeps a local draft and is keyed by the stored value, so saving
 * (or an edit from elsewhere) remounts it with fresh state.
 */
export const SettingsDialog = ({ onOpenChange, open, settings }: SettingsDialogProps) => (
  <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Model connection and prompts. Everything stays in this browser.
        </DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="connection">
        <TabsList>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="system">System prompt</TabsTrigger>
          <TabsTrigger value="passes">Pass prompts</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-4" value="connection">
          <ConnectionTab key={JSON.stringify(settings.llm)} llm={settings.llm} />
        </TabsContent>
        <TabsContent className="pt-4" value="system">
          <SystemPromptTab key={settings.systemPrompt} systemPrompt={settings.systemPrompt} />
        </TabsContent>
        <TabsContent className="pt-4" value="passes">
          <PassPromptsTab />
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
);
