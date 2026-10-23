import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addMonths } from "date-fns";
import {
  Sparkles,
  Plus,
  Check,
  Download,
  Upload,
  Trash2,
  Undo2,
  Send,
  Square,
  RefreshCw,
  ArrowRight,
  X,
  Settings as SettingsIcon,
  CalendarDays,
  Activity,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Palette,
  Users,
  CalendarHeart,
  Database,
  History,
  Github,
  Info,
  Tv,
} from "lucide-react";
import { authorBilibiliURL, authorName, projectRepoURL } from "./links";
import { registerSW } from "virtual:pwa-register";
import {
  db,
  initialize,
  restoreBirthdaySnapshot,
  repository,
  patchCharacter,
  put,
  exportBackup,
  validateBackup,
  importBackup,
  saveChat,
} from "./store";
import {
  defaults,
  newCharacter,
  type Data,
  type Character,
  type CustomEvent,
  type Task,
  type Log,
} from "./domain";
import {
  today,
  localDate,
  dateKey,
  occurrences,
  toICS,
  download,
  type Occurrence,
} from "./calendar";
import { syncBirthdays, type BangumiCharacter } from "./bangumi";
import { quietNetwork } from "./external-network";
import { type NetworkIssue } from "./external-network";
import {
  loadConfig,
  saveConfig,
  diagnoseAI,
  type DiagnosticStep,
  selectedModels,
  probeTools,
  runAssistant,
  applyPending,
  type AIConfig,
  type Pending,
} from "./ai";
import { useTheme } from "./theme";
import { hasVisibleReply } from "./ai-stream";
import {
  loadAssistantCheckpoint,
  clearAssistantCheckpoint,
} from "./assistant-state";
import {
  ErrorText,
  IconButton,
  Modal,
  PageHeader,
  Sparkle,
  eventBlank,
  navigation,
  taskBlank,
  type Page,
} from "./ui";
import { CharacterEditor, EventEditor, TaskEditor, defaultTag } from "./editors";
import { AddDialog, BangumiImport, type AddTab } from "./add-dialog";
import { CharacterChat } from "./character-chat";
import { ImageSettings } from "./image-settings";
import { PersonaSettings } from "./persona-settings";
import { ModelCombobox } from "./model-combobox";
import { useModelList } from "./use-models";
import { noteAutoEnabled, setNoteAuto, useNotePrefetch } from "./birthday-note";
import { localizeAvatars, isRemoteAvatar } from "./avatars";
import { Rail, TopBar, QuickCreate, CommandPalette } from "./shell";
import { Home } from "./pages/Home";
import { CalendarView } from "./pages/CalendarPage";
import { Characters } from "./pages/Characters";
import { Recommendations } from "./pages/Ideas";
import { Tasks } from "./pages/Tasks";

const fallbackData: Data = {
  characters: [],
  events: [],
  tasks: [],
  recommendations: [],
  settings: defaults,
};

export default function App() {
  const [ready, setReady] = useState(false),
    [fatal, setFatal] = useState(""),
    [page, setPage] = useState<Page>("home");
  const [assistant, setAssistant] = useState(false),
    [assistantMounted, setAssistantMounted] = useState(false),
    [assistantBusy, setAssistantBusy] = useState(false),
    [palette, setPalette] = useState(false),
    [notice, setNotice] = useState("");
  const [characterEdit, setCharacterEdit] = useState<Character | null>(null),
    [eventEdit, setEventEdit] = useState<CustomEvent | null>(null),
    [taskEdit, setTaskEdit] = useState<Task | null>(null);
  const [adding, setAdding] = useState<{
      tab: AddTab;
      event: CustomEvent;
    } | null>(null),
    [bangumiTarget, setBangumiTarget] = useState<Character | null>(null),
    [deleteTarget, setDeleteTarget] = useState<{
      collection: "characters" | "events" | "tasks";
      id: string;
      title: string;
    } | null>(null);
  const [chatWith, setChatWith] = useState<Character | null>(null);
  const [swUpdate, setSwUpdate] = useState<
    ((reload?: boolean) => Promise<void>) | null
  >(null);
  const [importCandidates, setImportCandidates] = useState<{
    characterId: string;
    results: BangumiCharacter[];
  } | null>(null);
  const [networkIssue, setNetworkIssue] = useState<NetworkIssue | null>(null);
  const [networkRetrying, setNetworkRetrying] = useState(false);
  const networkSources = useRef(new Set<string>());
  useEffect(() => {
    const listener = (event: Event) => {
      const issue = (event as Event & { detail: NetworkIssue }).detail;
      if (networkSources.current.has(issue.source)) return;
      networkSources.current.add(issue.source);
      setNetworkIssue(issue);
    };
    window.addEventListener("character-network-issue", listener);
    return () =>
      window.removeEventListener("character-network-issue", listener);
  }, []);
  const liveData = useLiveQuery(() => repository.snapshot(), []);
  const data = liveData ?? fallbackData;
  useTheme(data.settings.theme);
  useNotePrefetch(data.characters);
  const logs =
    useLiveQuery(
      () => db.logs.orderBy("createdAt").reverse().limit(20).toArray(),
      [],
    ) ?? [];
  useEffect(() => {
    initialize()
      .then(async () => {
        const initial = await db.settings.get("main");
        setPage(initial?.defaultView ?? "home");
        setReady(true);
        const launchURL = new URL(window.location.href);
        if (launchURL.searchParams.get("__huiqi_launch") === __APP_BUILD__) {
          launchURL.searchParams.delete("__huiqi_launch");
          window.history.replaceState(null, "", launchURL.href);
        }
        // 启动时在后台静默补生日：连不上也不提示，用户主动搜索或在设置里重试时才提示
        if (navigator.onLine)
          void quietNetwork(() => syncBirthdays()).catch(() => {});
      })
      .catch((e) => setFatal(String(e)));
    const update = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        registration?.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setSwUpdate(() => async () => {
                window.location.reload();
              });
          });
        });
        void registration?.update().catch(() => {});
      },
      onNeedRefresh() {
        setSwUpdate(() => update);
      },
    });
  }, []);
  useEffect(() => {
    const online = () =>
      void quietNetwork(() => syncBirthdays()).catch(() => {});
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const notify = (s: string) => setNotice(s);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      notify(success);
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败");
    }
  };
  const copyTag = async (characterId?: string) => {
    const c = data.characters.find((c) => c.id === characterId);
    if (!c) {
      notify("这个选题没有关联角色，没有可复制的 Tag");
      return false;
    }
    const tag = defaultTag(c).trim();
    if (!tag) {
      notify(`「${c.name}」还没有 Tag，请先在角色资料里填写或自动获取`);
      return false;
    }
    try {
      await navigator.clipboard.writeText(tag);
      notify(`已复制「${c.name}」的 Tag`);
      return true;
    } catch {
      notify("自动复制不可用，请在角色资料里手动选择 Tag 文本");
      return false;
    }
  };
  const toggleStar = (c: Character) =>
    void patchCharacter(c.id, { starred: !c.starred })
      .then(() => notify(c.starred ? `已取消标星「${c.name}」` : `已标星「${c.name}」`))
      .catch((e) => notify(e.message));
  const openAddEvent = (date?: string, tab: AddTab = "event") =>
    setAdding({
      tab,
      event: date
        ? {
            ...eventBlank(),
            recurrence: "once",
            date,
            month: Number(date.slice(5, 7)),
            day: Number(date.slice(8)),
          }
        : eventBlank(),
    });
  const openAddCharacter = () =>
    setAdding({ tab: "character", event: eventBlank() });
  const editOccurrence = (e: Occurrence) => {
    if (e.type === "task") {
      const t = data.tasks.find((t) => e.id.startsWith(`task:${t.id}`));
      if (t) setTaskEdit(t);
    } else if (e.type === "custom") {
      const v = data.events.find((v) => e.id.startsWith(`custom:${v.id}:`));
      if (v) setEventEdit(v);
    } else void copyTag(e.characterIds[0]);
  };
  const exportICS = (events?: Occurrence[]) => {
    download(
      "推日-创作日历.ics",
      toICS(
        events ??
          occurrences(
            data,
            today(),
            dateKey(addMonths(localDate(today()), 24)),
          ),
      ),
      "text/calendar;charset=utf-8",
    );
    notify("已导出日历");
  };
  const openAssistant = () => {
    setAssistantMounted(true);
    setAssistant(true);
  };
  const newTask = (characterId?: string, date?: string, title?: string) => {
    const c = data.characters.find((c) => c.id === characterId);
    setTaskEdit({
      ...taskBlank(),
      ...(date ? { date } : {}),
      ...(title ? { title } : {}),
      characterIds: c ? [c.id] : [],
      positive: c ? defaultTag(c) : "",
    });
  };
  const editItem = (e: Occurrence) => {
    if (e.type === "birthday") {
      const c = data.characters.find((c) => c.id === e.characterIds[0]);
      if (c) setCharacterEdit(c);
    } else editOccurrence(e);
  };
  const setTheme = (theme: Data["settings"]["theme"]) =>
    void put("settings", { ...data.settings, theme }, "更新外观主题").catch(
      (e) => notify(e.message),
    );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const closePalette = useCallback(() => setPalette(false), []);
  // 远程头像在后台保存到本机（失败的不反复重试，联网后再试）
  const localizing = useRef(false);
  const failedAvatars = useRef(new Set<string>());
  const [avatarTick, setAvatarTick] = useState(0);
  useEffect(() => {
    const retry = () => {
      failedAvatars.current.clear();
      setAvatarTick((n) => n + 1);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  useEffect(() => {
    if (!ready || localizing.current || !navigator.onLine) return;
    const pending = data.characters.filter(
      (c) =>
        isRemoteAvatar(c.avatarUrl) &&
        !failedAvatars.current.has(c.id + c.avatarUrl),
    );
    if (!pending.length) return;
    localizing.current = true;
    void localizeAvatars(pending, undefined, failedAvatars.current)
      .catch(() => {})
      .finally(() => {
        localizing.current = false;
        setAvatarTick((n) => n + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data.characters, avatarTick]);
  const paletteActions = useMemo(
    () => ({
      event: () => openAddEvent(),
      task: () => newTask(),
      character: openAddCharacter,
      assistant: openAssistant,
      theme: () =>
        setTheme(
          document.documentElement.dataset.theme === "dark" ? "light" : "dark",
        ),
      exportICS: () => exportICS(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  if (fatal)
    return (
      <main className="fatal">
        <h1>无法打开本地数据库</h1>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>重试</button>
      </main>
    );
  if (!ready)
    return (
      <div className="loading">
        <Loader2 className="spin" />
        正在打开推日…
      </div>
    );
  return (
    <div className="app-shell">
      <Rail page={page} onNavigate={setPage} />
      <div className="main-shell">
        <TopBar
          data={data}
          assistantBusy={assistantBusy}
          onSearch={() => setPalette(true)}
          onAssistant={openAssistant}
          onTheme={setTheme}
          quickCreate={
            <QuickCreate
              onEvent={() => openAddEvent()}
              onTask={() => newTask()}
              onCharacter={openAddCharacter}
            />
          }
        />
        {swUpdate && (
          <div className="update-banner">
            <Sparkle size={14} />
            新版本已就绪
            <button onClick={() => void swUpdate(true)}>更新应用</button>
            <IconButton title="稍后更新" onClick={() => setSwUpdate(null)}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <main key={page}>
          {page === "home" && (
            <Home
              data={data}
              onCharacter={setCharacterEdit}
              onCopyTag={copyTag}
              onStar={toggleStar}
              onOccurrence={editOccurrence}
              onEvent={() => openAddEvent()}
              onAdd={() => openAddEvent(undefined, "character")}
              onChat={setChatWith}
              onNavigate={setPage}
              onTask={setTaskEdit}
              onNewTask={newTask}
              onStatus={(t, status) =>
                run(
                  () => put("tasks", { ...t, status }, `更新任务：${t.title}`),
                  status === "done" ? "任务已完成，辛苦了" : "任务状态已更新",
                )
              }
              onUpdateSettings={(patch) =>
                void put(
                  "settings",
                  { ...data.settings, ...patch },
                  "更新工作台设置",
                ).catch((e) => notify(e.message))
              }
            />
          )}
          {page === "calendar" && (
            <CalendarView
              data={data}
              onOccurrence={editOccurrence}
              onEvent={() => openAddEvent()}
              onExport={exportICS}
              onAddEvent={openAddEvent}
              onAddTask={(date) => newTask(undefined, date)}
              onEditItem={editItem}
              onCopyTag={copyTag}
            />
          )}
          {page === "characters" && (
            <Characters
              data={data}
              onEdit={setCharacterEdit}
              onAdd={openAddCharacter}
              onCopyTag={copyTag}
              onStar={toggleStar}
              onChat={setChatWith}
            />
          )}
          {page === "recommendations" && (
            <Recommendations
              data={data}
              notify={notify}
              onCopyTag={copyTag}
              onTask={setTaskEdit}
            />
          )}
          {page === "tasks" && (
            <Tasks
              data={data}
              onEdit={setTaskEdit}
              onAdd={() => newTask()}
              onStatus={(t, status) =>
                run(
                  () => put("tasks", { ...t, status }, `更新任务：${t.title}`),
                  "任务状态已更新",
                )
              }
            />
          )}
          {page === "settings" && (
            <SettingsView
              data={data}
              logs={logs}
              notify={notify}
              onEvent={() => openAddEvent()}
              onEditEvent={setEventEdit}
              onDeleteEvent={(e) =>
                setDeleteTarget({
                  collection: "events",
                  id: e.id,
                  title: e.title,
                })
              }
              onExport={exportICS}
              onCharacterLookup={(character, results) => {
                setImportCandidates(
                  results ? { characterId: character.id, results } : null,
                );
                setBangumiTarget(character);
              }}
            />
          )}
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {notice}
          <IconButton title="关闭提示" onClick={() => setNotice("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {characterEdit && (
        <CharacterEditor
          character={characterEdit}
          onClose={() => setCharacterEdit(null)}
          onSaved={(record) => {
            setCharacterEdit(null);
            notify("角色已保存");
            if (
              !characterEdit.name &&
              !record.bangumiId &&
              !record.anilistId &&
              (!record.avatarUrl || !record.birthday) &&
              navigator.onLine
            ) {
              setImportCandidates(null);
              setBangumiTarget(record);
            }
          }}
          onBangumi={(record) => {
            setImportCandidates(null);
            setBangumiTarget(record);
            setCharacterEdit(null);
          }}
          onDelete={() =>
            setDeleteTarget({
              collection: "characters",
              id: characterEdit.id,
              title: characterEdit.name,
            })
          }
        />
      )}
      {adding && (
        <AddDialog
          initialTab={adding.tab}
          event={adding.event}
          data={data}
          onClose={() => setAdding(null)}
          onEventSaved={() => {
            setAdding(null);
            notify("节日已保存");
          }}
          onSaved={(c, added) => {
            setAdding(null);
            notify(added ? `已添加角色「${c.name}」` : `已关联「${c.name}」`);
          }}
          onManual={(name) => {
            setAdding(null);
            setCharacterEdit(newCharacter(name));
          }}
        />
      )}
      {eventEdit && (
        <EventEditor
          event={eventEdit}
          onClose={() => setEventEdit(null)}
          onSaved={() => {
            setEventEdit(null);
            notify("节日已保存");
          }}
        />
      )}
      {taskEdit && (
        <TaskEditor
          task={taskEdit}
          data={data}
          onClose={() => setTaskEdit(null)}
          onSaved={() => {
            setTaskEdit(null);
            notify("创作任务已保存");
          }}
          onDelete={() =>
            setDeleteTarget({
              collection: "tasks",
              id: taskEdit.id,
              title: taskEdit.title,
            })
          }
        />
      )}
      {chatWith && (
        <CharacterChat
          character={chatWith}
          notify={notify}
          onClose={() => setChatWith(null)}
          onSettings={() => {
            setChatWith(null);
            setPage("settings");
          }}
        />
      )}
      {bangumiTarget && (
        <BangumiImport
          target={bangumiTarget}
          initialResults={
            importCandidates?.characterId === bangumiTarget.id
              ? importCandidates.results
              : undefined
          }
          data={data}
          onClose={() => setBangumiTarget(null)}
          onSaved={(c) => {
            setBangumiTarget(null);
            notify(`已关联「${c.name}」`);
          }}
        />
      )}
      {deleteTarget && (
        <Modal title="确认删除" onClose={() => setDeleteTarget(null)}>
          <div className="modal-body">
            <p>删除「{deleteTarget.title}」？操作记录中可以撤销。</p>
          </div>
          <footer>
            <button onClick={() => setDeleteTarget(null)}>取消</button>
            <button
              className="danger-button"
              onClick={() =>
                void run(async () => {
                  await repository.apply(
                    [
                      {
                        collection: deleteTarget.collection,
                        action: "delete",
                        id: deleteTarget.id,
                      },
                    ],
                    `删除：${deleteTarget.title}`,
                  );
                  setDeleteTarget(null);
                  setCharacterEdit(null);
                  setTaskEdit(null);
                }, "已删除，可在设置中撤销")
              }
            >
              删除
            </button>
          </footer>
        </Modal>
      )}
      {networkIssue && (
        <Modal
          title="角色资料网络连接失败"
          onClose={() => setNetworkIssue(null)}
        >
          <div className="modal-body">
            <p>{networkIssue.message}</p>
            <p>
              {networkIssue.kind === "http"
                ? "接口返回错误，请检查提示并稍后重试。"
                : "请检查网络。若所在网络无法访问，请打开 VPN／代理，并确认浏览器使用了代理，然后点击重试。"}
            </p>
            <p className="muted">
              Bangumi 不可用时会尝试
              AniList。两者都可能受网络限制；已保存的资料和内置生日不受影响。
            </p>
          </div>
          <footer>
            <button
              onClick={() => {
                setNetworkIssue(null);
                setPage("settings");
              }}
            >
              查看资料设置
            </button>
            <button onClick={() => setNetworkIssue(null)}>稍后处理</button>
            <button
              className="primary"
              disabled={networkRetrying}
              onClick={() => {
                setNetworkRetrying(true);
                networkSources.current.clear();
                void syncBirthdays(true)
                  .then((result) => {
                    if (!result.failed) setNetworkIssue(null);
                    else
                      setNetworkIssue({
                        source: networkIssue.source,
                        kind: networkIssue.kind,
                        message: result.errors.join("；"),
                      });
                    notify(
                      `补齐 ${result.updated} 位，${result.unresolved} 位待确认，${result.failed} 位请求失败`,
                    );
                  })
                  .catch((e) => notify(e.message))
                  .finally(() => setNetworkRetrying(false));
              }}
            >
              <RefreshCw size={16} />
              {networkRetrying ? "正在重试" : "已开启 VPN，重试"}
            </button>
          </footer>
        </Modal>
      )}
      {palette && (
        <CommandPalette
          data={data}
          onClose={closePalette}
          onNavigate={setPage}
          onCharacter={setCharacterEdit}
          onCopyTag={copyTag}
          actions={paletteActions}
        />
      )}
      {assistantMounted && (
        <AssistantPanel
          open={assistant}
          onBusyChange={setAssistantBusy}
          onClose={() => setAssistant(false)}
          notify={notify}
          onSettings={() => {
            setPage("settings");
            setAssistant(false);
          }}
        />
      )}
    </div>
  );
}

const settingsSections = [
  { id: "set-general", label: "外观与提醒", icon: Palette },
  { id: "set-sync", label: "角色资料", icon: Users },
  { id: "set-ai", label: "AI 接口", icon: Sparkles },
  { id: "set-persona", label: "聊天中的我", icon: Users },
  { id: "set-image", label: "生图接口", icon: ImageIcon },
  { id: "set-events", label: "自定义节日", icon: CalendarHeart },
  { id: "set-backup", label: "数据与备份", icon: Database },
  { id: "set-log", label: "操作记录", icon: History },
  { id: "set-about", label: "关于", icon: Info },
] as const;

function SettingsView({
  data,
  logs,
  notify,
  onEvent,
  onEditEvent,
  onDeleteEvent,
  onExport,
  onCharacterLookup,
}: {
  data: Data;
  logs: Log[];
  notify: (s: string) => void;
  onEvent: () => void;
  onEditEvent: (e: CustomEvent) => void;
  onDeleteEvent: (e: CustomEvent) => void;
  onExport: () => void;
  onCharacterLookup: (
    character: Character,
    results?: BangumiCharacter[],
  ) => void;
}) {
  const [config, setConfig] = useState<AIConfig>(loadConfig()),
    [testing, setTesting] = useState(false),
    [backup, setBackup] = useState<ReturnType<typeof validateBackup> | null>(
      null,
    ),
    [importCounts, setImportCounts] = useState({ added: 0, updated: 0 }),
    [storage, setStorage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [birthdayStatus, setBirthdayStatus] = useState("");
  const [noteAuto, setNoteAutoState] = useState(noteAutoEnabled);
  const [savingAvatars, setSavingAvatars] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("");
  const localAvatars = data.characters.filter((c) =>
    c.avatarUrl.startsWith("data:"),
  ).length;
  const remoteAvatars = data.characters.filter((c) =>
    isRemoteAvatar(c.avatarUrl),
  ).length;
  const saveAvatarsNow = async () => {
    setSavingAvatars(true);
    setAvatarStatus("正在把头像保存到本机…");
    try {
      const r = await localizeAvatars(data.characters, (done, total) =>
        setAvatarStatus(`正在保存头像 ${done} / ${total}…`),
      );
      const message = `已保存 ${r.saved} 位头像到本机${r.failed ? `，${r.failed} 位失败：${r.errors.slice(0, 3).join("；")}` : ""}`;
      setAvatarStatus(message);
      notify(message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "保存失败";
      setAvatarStatus(message);
      notify(message);
    } finally {
      setSavingAvatars(false);
    }
  };
  const [lookupCandidates, setLookupCandidates] = useState<
    { characterId: string; results: BangumiCharacter[] }[]
  >([]);
  const unlinkedCharacters = data.characters.filter(
    (c) => !c.bangumiId && !c.anilistId,
  );
  const [modelQuery, setModelQuery] = useState("");
  const modelList = useModelList(config.endpoint, config.key);
  const upstreamModels = modelList.models;
  const modelError = modelList.error;
  const fetchingModels = modelList.loading;
  const [diagnosis, setDiagnosis] = useState<DiagnosticStep[] | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const diagController = useRef<AbortController | null>(null);
  useEffect(() => () => diagController.current?.abort(), []);
  const getModels = async () => {
    const models = await modelList.fetchNow(true);
    if (!models) return;
    setModelQuery("");
    notify(`已获取 ${models.length} 个模型，请勾选常用模型并保存配置`);
  };
  const runDiagnosis = async () => {
    const controller = new AbortController();
    diagController.current?.abort();
    diagController.current = controller;
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const steps = await diagnoseAI(config, controller.signal);
      if (!controller.signal.aborted) setDiagnosis(steps);
    } finally {
      if (diagController.current === controller) setDiagnosing(false);
    }
  };
  const toggleModel = (model: string) =>
    setConfig((current) => {
      const selected = selectedModels(current);
      const models = selected.includes(model)
        ? selected.filter((item) => item !== model)
        : [...selected, model];
      return {
        ...current,
        models,
        model: models.includes(current.model) ? current.model : models[0] || "",
      };
    });
  const refreshBirthdays = async () => {
    setSyncing(true);
    setBirthdayStatus("正在获取头像、生日并搜索未关联角色…");
    try {
      const r = await syncBirthdays(true);
      setLookupCandidates(r.candidates);
      const message = `获取完成：${r.linked} 位角色已自动关联，${r.updated} 位生日、${r.avatars} 位头像已补齐，${r.unresolved} 位缺失或待确认，${r.failed} 位请求失败，AniList 匹配 ${r.fallback} 位${r.candidates.length ? `。${r.candidates.length} 位未匹配或有歧义，可展开未关联角色选择资料` : ""}${r.errors.length ? `。${r.errors.join("；")}` : ""}`;
      setBirthdayStatus(message);
      notify(message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "获取失败";
      setBirthdayStatus(message);
      notify(message);
    } finally {
      setSyncing(false);
    }
  };
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then((v) =>
        setStorage(`${((v.usage ?? 0) / 1024 / 1024).toFixed(1)} MB`),
      );
  }, []);
  const test = async () => {
    setTesting(true);
    saveConfig(config);
    try {
      const support = await probeTools(config);
      const next = {
        ...config,
        mode: support ? ("tools" as const) : ("json" as const),
      };
      setConfig(next);
      saveConfig(next);
      notify(
        support
          ? "连接成功，模型支持工具调用"
          : "连接成功，使用 JSON 提案兼容模式",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "检测失败");
    } finally {
      setTesting(false);
    }
  };
  const chooseBackup = async (f?: File) => {
    if (!f) return;
    try {
      const b = validateBackup(JSON.parse(await f.text()));
      const existing = new Set(
        [
          ...data.characters,
          ...data.events,
          ...data.tasks,
          ...data.recommendations,
        ].map((r) => r.id),
      );
      const records = [
        ...b.characters,
        ...b.events,
        ...b.tasks,
        ...b.recommendations,
      ];
      setImportCounts({
        added: records.filter((r) => !existing.has(r.id)).length,
        updated: records.filter((r) => existing.has(r.id)).length,
      });
      setBackup(b);
    } catch (e) {
      notify(e instanceof Error ? e.message : "备份无效");
    }
    if (file.current) file.current.value = "";
  };
  const [activeSection, setActiveSection] = useState("set-general");
  useEffect(() => {
    const els = settingsSections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  const update = (patch: Partial<Data["settings"]>) =>
    void put("settings", { ...data.settings, ...patch }, "更新常用设置").catch(
      (e) => notify(e.message),
    );
  return (
    <>
      <PageHeader eyebrow="WORKSPACE SETTINGS" title="工作空间设置">
        提醒、AI 接口与本地数据
      </PageHeader>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          {settingsSections.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeSection === id ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Icon size={17} />
              {label}
            </a>
          ))}
        </nav>
        <div className="settings-sections">
        <section className="settings-section" id="set-general">
          <h2>
            <Palette size={18} />
            外观与提醒
          </h2>
          <div className="setting-row">
            <div>
              <strong>外观主题</strong>
              <span>默认跟随系统，实时切换日间与夜间</span>
            </div>
            <select
              aria-label="外观主题"
              value={data.settings.theme}
              onChange={(e) =>
                update({ theme: e.target.value as Data["settings"]["theme"] })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">日间模式</option>
              <option value="dark">夜间模式</option>
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>默认提前提醒</strong>
              <span>生日和节日可单独设置</span>
            </div>
            <div className="inline-field">
              <input
                aria-label="默认提前提醒天数"
                type="number"
                min="0"
                max="365"
                value={data.settings.reminderDays}
                onChange={(e) =>
                  update({ reminderDays: Number(e.target.value) })
                }
              />
              天
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>默认打开页面</strong>
            </div>
            <select
              aria-label="默认打开页面"
              value={data.settings.defaultView}
              onChange={(e) =>
                update({
                  defaultView: e.target
                    .value as Data["settings"]["defaultView"],
                })
              }
            >
              {navigation
                .filter((n) => n.id !== "settings")
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="setting-row">
            <div>
              <strong>二十四节气</strong>
            </div>
            <input
              aria-label="显示二十四节气"
              className="toggle"
              type="checkbox"
              checked={data.settings.solarTerms}
              onChange={(e) => update({ solarTerms: e.target.checked })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>更多创作节日</strong>
              <span>情人节、万圣节、圣诞节与日本七夕</span>
            </div>
            <input
              aria-label="显示更多创作节日"
              className="toggle"
              type="checkbox"
              checked={data.settings.extraHolidays}
              onChange={(e) => update({ extraHolidays: e.target.checked })}
            />
          </div>
          <div className="setting-row">
            <div>
              <strong>时区</strong>
            </div>
            <span>Asia/Shanghai</span>
          </div>
        </section>
        <section className="settings-section" id="set-sync">
          <h2>
            <Users size={18} />
            角色资料与更新
          </h2>
          <div className="setting-row">
            <div>
              <strong>自动获取头像和生日</strong>
              <span>
                自动搜索并关联身份匹配且唯一的角色，补齐空头像和生日；重名需选择，手动资料保留
              </span>
              <span>
                {
                  data.characters.filter(
                    (c) => c.birthdayConfidence === "confirmed" && c.birthday,
                  ).length
                }{" "}
                位生日已确认，
                {
                  data.characters.filter(
                    (c) => !c.birthday && c.birthdayConfidence !== "none",
                  ).length
                }{" "}
                位缺失或待确认 ，
                {
                  data.characters.filter((c) => c.birthdayConfidence === "none")
                    .length
                }{" "}
                位无生日
              </span>
              {birthdayStatus && <span role="status">{birthdayStatus}</span>}
            </div>
            <button disabled={syncing} onClick={() => void refreshBirthdays()}>
              {syncing ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              立即获取
            </button>
          </div>
          <details className="unlinked-characters">
            <summary>未关联角色（{unlinkedCharacters.length}）</summary>
            {!unlinkedCharacters.length && (
              <p className="muted">所有角色均已关联资料来源。</p>
            )}
            {unlinkedCharacters.map((c) => {
              const lookup = lookupCandidates.find(
                (r) => r.characterId === c.id,
              );
              return (
                <div className="setting-row" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {lookup
                        ? lookup.results.length
                          ? `找到 ${lookup.results.length} 个候选，身份匹配不明确，请选择`
                          : "未找到资料，请换用日文／英文角色名搜索"
                        : "点击立即获取自动匹配，也可手动选择资料"}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      onCharacterLookup(
                        c,
                        lookup?.results.length ? lookup.results : undefined,
                      )
                    }
                  >
                    选择资料 · {c.name}
                  </button>
                </div>
              );
            })}
          </details>
          <div className="setting-row">
            <div>
              <strong>头像保存到本机</strong>
              <span>
                {localAvatars} / {data.characters.length}{" "}
                位角色的头像已保存在本机，离线也能显示，并随 JSON
                备份导出。
                {remoteAvatars
                  ? `还有 ${remoteAvatars} 位使用在线地址，联网时会自动保存。`
                  : ""}
              </span>
              {avatarStatus && <span role="status">{avatarStatus}</span>}
            </div>
            <button
              disabled={savingAvatars || !remoteAvatars}
              onClick={() => void saveAvatarsNow()}
            >
              {savingAvatars ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              立即保存
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>已核对生日资料</strong>
              <span>本地补齐14位示例角色，保留手动日期和冲突候选</span>
            </div>
            <button
              onClick={() =>
                void restoreBirthdaySnapshot()
                  .then((count) => notify(`已补齐 ${count} 位本地生日`))
                  .catch((e) => notify(e.message))
              }
            >
              <RefreshCw size={16} />
              补齐本地生日
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>应用版本</strong>
              <span>{__APP_BUILD__}</span>
            </div>
            <button
              onClick={() => {
                void navigator.serviceWorker
                  ?.getRegistration()
                  .then(async (registration) => {
                    if (!registration) {
                      notify("开发模式未启用离线缓存");
                      return;
                    }
                    await registration.update();
                    if (registration.waiting)
                      registration.waiting.postMessage({
                        type: "SKIP_WAITING",
                      });
                    else notify("已检查更新；新版本准备好时会显示更新提示");
                  })
                  .catch((e) => notify(`更新检查失败：${e.message}`));
              }}
            >
              检查更新
            </button>
          </div>
        </section>
        <section className="settings-section" id="set-ai">
          <h2>
            <Sparkles size={18} />
            AI 接口
          </h2>
          <label>
            接口地址
            <input
              value={config.endpoint}
              onChange={(e) =>
                setConfig({ ...config, endpoint: e.target.value })
              }
              placeholder="https://api.openai.com/v1"
            />
          </label>
          <label>
            模型
            <ModelCombobox
              ariaLabel="模型"
              value={config.model}
              onChange={(model) => setConfig({ ...config, model })}
              models={upstreamModels}
              loading={fetchingModels}
              openKey={modelList.openKey}
              placeholder="填写服务提供的模型名称，或从获取到的列表里选"
            />
          </label>
          <div className="model-fetch-row">
            <button disabled={fetchingModels} onClick={() => void getModels()}>
              {fetchingModels ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              从上游获取模型
            </button>
            {fetchingModels && (
              <button
                onClick={() => modelList.cancel()}
              >
                取消获取
              </button>
            )}
            <button disabled={diagnosing} onClick={() => void runDiagnosis()}>
              {diagnosing ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Activity size={16} />
              )}
              连接诊断
            </button>
          </div>
          <ErrorText error={modelError} />
          {diagnosis && (
            <ul className="diag-list" aria-label="连接诊断结果">
              {diagnosis.map((step) => (
                <li key={step.label} className={step.ok ? "ok" : "bad"}>
                  {step.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!!upstreamModels.length && (
            <div className="model-picker">
              <label>
                筛选上游模型
                <input
                  aria-label="筛选上游模型"
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  placeholder="输入模型名称"
                />
              </label>
              <div
                className="model-options"
                role="group"
                aria-label="上游模型多选"
              >
                {upstreamModels
                  .filter((model) =>
                    model.toLowerCase().includes(modelQuery.toLowerCase()),
                  )
                  .map((model) => (
                    <label className="check-label model-option" key={model}>
                      <input
                        type="checkbox"
                        checked={selectedModels(config).includes(model)}
                        onChange={() => toggleModel(model)}
                      />
                      <span>{model}</span>
                    </label>
                  ))}
                {!upstreamModels.some((model) =>
                  model.toLowerCase().includes(modelQuery.toLowerCase()),
                ) && <p className="muted">没有匹配的模型</p>}
              </div>
            </div>
          )}
          {!!selectedModels(config).length && (
            <>
              <div className="selected-models" aria-label="已选模型">
                {selectedModels(config).map((model) => (
                  <button
                    key={model}
                    title={`移除模型 ${model}`}
                    onClick={() => toggleModel(model)}
                  >
                    <span>{model}</span>
                    <X size={13} />
                  </button>
                ))}
              </div>
              <label>
                默认模型
                <select
                  aria-label="默认模型"
                  value={config.model.trim()}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      models: selectedModels(config),
                      model: e.target.value,
                    })
                  }
                >
                  {!config.model.trim() && (
                    <option value="">请选择默认模型</option>
                  )}
                  {selectedModels(config).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <p className="muted">
            可多选常用模型，保存后在聊天窗口切换。手动填写的模型也会加入已选列表；上游列表不代表所有模型都支持聊天或工具调用。
          </p>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={config.key}
              onChange={(e) => setConfig({ ...config, key: e.target.value })}
              placeholder="仅保存在此设备"
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.remember}
              onChange={(e) =>
                setConfig({ ...config, remember: e.target.checked })
              }
            />
            记住密钥（本机浏览器）
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={noteAuto}
              onChange={(e) => {
                setNoteAutoState(e.target.checked);
                setNoteAuto(e.target.checked);
              }}
            />
            首页寿星卡自动生成角色留言（每天最多一次，只发送角色名和作品名）
          </label>
          <label>
            助手兼容模式
            <select
              value={config.mode}
              onChange={(e) =>
                setConfig({
                  ...config,
                  mode: e.target.value as AIConfig["mode"],
                })
              }
            >
              <option value="tools">工具调用 · 自动执行明确修改</option>
              <option value="json">JSON 兼容 · 校验后自动保存</option>
            </select>
          </label>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => {
                saveConfig(config);
                notify("AI 接口设置已保存");
              }}
            >
              <Check size={16} />
              保存配置
            </button>
            <button disabled={testing} onClick={() => void test()}>
              {testing ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              检测工具调用
            </button>
          </div>
        </section>
        <PersonaSettings notify={notify} />
        <ImageSettings notify={notify} />
        <section className="settings-section" id="set-events">
          <div className="section-heading">
            <h2>
              <CalendarHeart size={18} />
              自定义节日
            </h2>
            <IconButton title="添加自定义节日" onClick={onEvent}>
              <Plus size={18} />
            </IconButton>
          </div>
          {data.events.map((e) => (
            <div className="setting-row" key={e.id}>
              <div>
                <button className="text-button" onClick={() => onEditEvent(e)}>
                  {e.title}
                </button>
                <span>
                  {e.recurrence === "once"
                    ? e.date
                    : `${e.recurrence === "lunar" ? "农历" : "公历"} ${e.month}月${e.day}日 · 每年`}
                </span>
              </div>
              <IconButton
                title={`删除 ${e.title}`}
                onClick={() => onDeleteEvent(e)}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
          {!data.events.length && <p className="muted">暂无自定义节日</p>}
        </section>
        <section className="settings-section" id="set-backup">
          <h2>
            <Database size={18} />
            数据与备份
          </h2>
          <div className="setting-row">
            <div>
              <strong>本地存储</strong>
              <span>
                {data.characters.length} 位角色 · {data.tasks.length} 项任务 ·{" "}
                {storage || "正在计算"}
              </span>
            </div>
            <span className="badge local">IndexedDB</span>
          </div>
          <p className="muted">
            清除浏览器数据会删除本地记录。备份包含角色、Tag、任务和本地头像，不含
            API 密钥。
          </p>
          <div className="button-row wrap">
            <button
              onClick={() =>
                void exportBackup().then((b) =>
                  download(
                    `推日备份-${today()}.json`,
                    JSON.stringify(b, null, 2),
                  ),
                )
              }
            >
              <Download size={16} />
              导出 JSON
            </button>
            <button onClick={() => file.current?.click()}>
              <Upload size={16} />
              导入 JSON
            </button>
            <button onClick={onExport}>
              <CalendarDays size={16} />
              导出日历
            </button>
          </div>
          <input
            ref={file}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={(e) => void chooseBackup(e.target.files?.[0])}
          />
        </section>
        <section className="settings-section" id="set-log">
          <h2>
            <History size={18} />
            操作记录
          </h2>
          {logs.map((log) => (
            <div className="setting-row" key={log.id}>
              <div>
                <strong>{log.summary}</strong>
                <span>
                  {new Date(log.createdAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}{" "}
                  · {log.changes.length} 条变更
                </span>
              </div>
              <button
                disabled={log.undone}
                onClick={() =>
                  void repository
                    .undo(log.id)
                    .then(() => notify("已撤销"))
                    .catch((e) => notify(e.message))
                }
              >
                <Undo2 size={16} />
                {log.undone ? "已撤销" : "撤销"}
              </button>
            </div>
          ))}
          {!logs.length && <p className="muted">暂无修改记录</p>}
        </section>
        <section className="settings-section" id="set-about">
          <h2>
            <Info size={18} />
            关于
          </h2>
          <div className="setting-row">
            <div>
              <strong>作者</strong>
              <span>{authorName}</span>
            </div>
            <a
              className="link-button"
              href={authorBilibiliURL}
              target="_blank"
              rel="noreferrer"
            >
              <Tv size={16} />
              B 站主页
            </a>
          </div>
          <div className="setting-row">
            <div>
              <strong>项目源码</strong>
              <span>github.com/befoer/oshi-calendar</span>
            </div>
            <a
              className="link-button"
              href={projectRepoURL}
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} />
              GitHub
            </a>
          </div>
        </section>
        </div>
      </div>
      {backup && (
        <Modal title="确认导入备份" onClose={() => setBackup(null)}>
          <div className="modal-body">
            <p>
              新增 {importCounts.added} 条，更新 {importCounts.updated}{" "}
              条资料。相同 ID 的记录将使用备份内容，其他现有资料保留。
            </p>
            <p>提醒与默认页面设置也会恢复。AI 密钥不会被修改。</p>
          </div>
          <footer>
            <button onClick={() => setBackup(null)}>取消</button>
            <button
              className="primary"
              onClick={() =>
                void importBackup(backup)
                  .then(() => {
                    setBackup(null);
                    notify("备份已恢复");
                  })
                  .catch((e) => notify(e.message))
              }
            >
              确认导入
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}

function ChangePreview({ pending }: { pending: Pending }) {
  return (
    <div className="change-preview">
      <strong>{pending.summary}</strong>
      {pending.reasons.map((r, i) => (
        <p className="preview-reason" key={i}>
          {r}
        </p>
      ))}
      {pending.operations
        .filter(
          (op) =>
            op.collection === "characters" &&
            op.record &&
            "birthdaySource" in op.record &&
            op.record.birthdaySource.includes("通过 AI 网页检索"),
        )
        .map((op) => {
          const character = op.record as Character;
          const url = character.birthdaySource.match(/https?:\/\/[^\s]+/)?.[0];
          return (
            <div className="birthday-evidence" key={character.id}>
              <strong>
                {character.name} · {character.birthday?.month}月
                {character.birthday?.day}日
              </strong>
              <p>{character.birthdaySource}</p>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  打开生日来源核对
                </a>
              )}
            </div>
          );
        })}
      {pending.operations.map((op, i) => {
        const before = pending.expected.find(
          (e) =>
            e.collection === op.collection && e.id === (op.record?.id ?? op.id),
        );
        return (
          <details key={i}>
            <summary>
              {op.action === "delete" ? "删除" : before ? "修改" : "新增"} ·{" "}
              {(op.record &&
                ("name" in op.record
                  ? op.record.name
                  : "title" in op.record
                    ? op.record.title
                    : "常用设置")) ||
                (before
                  ? (() => {
                      const r = JSON.parse(before.value);
                      return r.name || r.title || op.id;
                    })()
                  : op.id)}
            </summary>
            {before && (
              <>
                <span>修改前</span>
                <pre>{JSON.stringify(JSON.parse(before.value), null, 2)}</pre>
              </>
            )}
            <span>修改后</span>
            <pre>
              {JSON.stringify(op.record ?? { deleted: op.id }, null, 2)}
            </pre>
          </details>
        );
      })}
    </div>
  );
}

function AssistantPanel({
  open,
  onBusyChange,
  onClose,
  notify,
  onSettings,
}: {
  open: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  notify: (s: string) => void;
  onSettings: () => void;
}) {
  const [chatConfig, setChatConfig] = useState(loadConfig);
  useEffect(() => {
    const refresh = () => setChatConfig(loadConfig());
    window.addEventListener("huiqi-ai-config-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("huiqi-ai-config-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const chats =
    useLiveQuery(() => db.chats.orderBy("createdAt").toArray(), []) ?? [];
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [logs, setLogs] = useState<Log[]>([]),
    [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [phase, setPhase] = useState("正在处理…");
  const [recoverable, setRecoverable] = useState(false);
  const [recoveryInfo, setRecoveryInfo] = useState("");
  const streamRef = useRef("");
  const [toolActivity, setToolActivity] = useState<
    Extract<import("./ai").AssistantProgress, { type: "tool" }>[]
  >([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    void loadAssistantCheckpoint().then(async (saved) => {
      if (!saved || controller.current) return;
      setRecoverable(!saved.pending);
      setRecoveryInfo(
        `已保留 ${saved.pages.length} 篇资料与 ${saved.logIds.length} 批已保存修改`,
      );
      setPending(saved.pending ?? null);
      setError(saved.error ?? "");
      setToolActivity(
        saved.activity.map((p) =>
          p.status === "running"
            ? { ...p, status: "error", detail: "上次查询中断，可继续" }
            : p,
        ),
      );
      const savedLogs = await db.logs.bulkGet(saved.logIds);
      setLogs(savedLogs.filter((log): log is Log => !!log));
    });
  }, []);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (open)
      bottom.current?.scrollIntoView({ behavior: busy ? "instant" : "smooth" });
  }, [open, chats.length, busy, pending, streamText, toolActivity]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const send = async (resume = false) => {
    if ((!resume && !text.trim()) || busy || pending) return;
    const prompt = text.trim();
    if (!resume) setText("");
    setError("");
    if (!resume) setLogs([]);
    setStreamText("");
    streamRef.current = "";
    if (!resume) setToolActivity([]);
    setRecoverable(false);
    setPhase(resume ? "正在续接已保留的操作…" : "正在处理…");
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!resume) await saveChat("user", prompt);
      const result = await runAssistant(
        { ...loadConfig(), model: chatConfig.model },
        [
          ...chats.map((c) => ({ role: c.role, content: c.content })),
          { role: "user", content: prompt },
        ],
        abort.signal,
        (log) => setLogs((v) => [...v, log]),
        (progress) => {
          if (progress.type === "text") {
            streamRef.current = progress.text;
            setStreamText(progress.text);
          } else if (progress.type === "status") {
            setPhase(progress.text);
          } else {
            setToolActivity((old) => [
              ...old.filter((p) => p.id !== progress.id),
              progress,
            ]);
          }
        },
        resume,
      );
      setStreamText("");
      await saveChat("assistant", result.text);
      setPending(result.pending ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
      setStreamText("");
      if (hasVisibleReply(streamRef.current))
        await saveChat(
          "assistant",
          `[回复中断，以下为未完成内容]\n${streamRef.current}`,
        );
    } finally {
      setStreamText("");
      setToolActivity((old) =>
        old.map((p) =>
          p.status === "running"
            ? {
                ...p,
                status: "error",
                detail: "请求已结束，未取得成功结果",
              }
            : p,
        ),
      );
      const saved = await loadAssistantCheckpoint().catch(() => undefined);
      setRecoverable(!!saved && !saved.pending);
      setRecoveryInfo(
        saved
          ? `已保留 ${saved.pages.length} 篇资料与 ${saved.logIds.length} 批已保存修改`
          : "",
      );
      controller.current = null;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const log = await applyPending(pending);
      setLogs((v) => [...v, log]);
      await saveChat(
        "assistant",
        `已保存：${log.summary}。${log.changes.length} 条变更，可撤销。`,
      );
      setPending(null);
      await clearAssistantCheckpoint();
      setRecoverable(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: open ? "contents" : "none" }}>
      <div className="assistant-shade" onClick={onClose} />
      <aside
        className="assistant-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI 创作助手"
      >
        <header>
          <div>
            <Sparkles size={21} />
            <h2>AI 创作助手</h2>
          </div>
          <div>
            <IconButton title="接口设置" onClick={onSettings}>
              <SettingsIcon size={18} />
            </IconButton>
            <IconButton
              title="清除对话"
              disabled={busy}
              onClick={() => {
                if (window.confirm("清除本机对话记录与未完成查询？")) {
                  void db.transaction(
                    "rw",
                    db.chats,
                    db.assistantRuns,
                    async () => {
                      await db.chats.clear();
                      await db.assistantRuns.clear();
                    },
                  );
                  setPending(null);
                  setRecoverable(false);
                  setToolActivity([]);
                  setLogs([]);
                  setError("");
                }
              }}
            >
              <Trash2 size={18} />
            </IconButton>
            <IconButton title="关闭助手" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        </header>
        <div className="assistant-status">
          <span className="status-dot" />
          {chatConfig.mode === "tools"
            ? "工具调用 · 明确修改自动保存"
            : "兼容模式 · 校验后自动保存，可撤销"}
        </div>
        <div className="assistant-model">
          <label htmlFor="chat-model">聊天模型</label>
          <select
            id="chat-model"
            aria-label="聊天模型"
            value={chatConfig.model}
            disabled={busy || !!pending}
            onChange={(e) => {
              const next = { ...loadConfig(), model: e.target.value };
              saveConfig(next);
              setChatConfig(next);
            }}
          >
            {!chatConfig.model && (
              <option value="">请先在设置中选择模型</option>
            )}
            {selectedModels(chatConfig).map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
        <div className="assistant-model">
          <label htmlFor="chat-reasoning">思考强度</label>
          <select
            id="chat-reasoning"
            aria-label="思考强度"
            value={chatConfig.reasoningEffort ?? "default"}
            disabled={busy || !!pending}
            onChange={(e) => {
              const next = {
                ...loadConfig(),
                reasoningEffort: e.target.value as AIConfig["reasoningEffort"],
              };
              saveConfig(next);
              setChatConfig(next);
            }}
          >
            <option value="default">默认（跟随模型）</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </div>
        <div className="chat-scroll">
          {!chats.length && (
            <div className="assistant-welcome">
              <div className="assistant-glyph">
                <Sparkles size={27} />
              </div>
              <h3>今天想安排什么？</h3>
              {[
                "新增每年 11 月 11 日的自定义节日",
                "给洛琪希添加冬装预设",
                "安排未来三个月的冬日主题任务",
              ].map((s) => (
                <button key={s} onClick={() => setText(s)}>
                  {s}
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          )}
          {chats.map((c) => (
            <div className={`chat-message ${c.role}`} key={c.id}>
              {c.role === "assistant" && <Sparkles size={16} />}
              <p>{c.content}</p>
            </div>
          ))}
          {busy && (
            <div className="chat-thinking">
              <Loader2 className="spin" size={16} />
              {streamText ? "正在接收回复…" : phase}
            </div>
          )}
          {busy && streamText && (
            <div
              className="chat-message assistant streaming"
              aria-label="流式回复"
            >
              <Sparkles size={16} />
              <p>{streamText}</p>
            </div>
          )}
          {toolActivity.length > 0 && (
            <div className="tool-activity" aria-label="实际工具执行记录">
              <strong>本次工具执行</strong>
              {toolActivity.map((activity) => (
                <div
                  key={activity.id}
                  className={`tool-entry ${activity.status}`}
                >
                  <span>
                    {activity.status === "running" ? (
                      <Loader2 className="spin" size={14} />
                    ) : activity.status === "error" ? (
                      <AlertCircle size={14} />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    {{
                      query_data: "查询资料",
                      search_web: "网页搜索",
                      read_web: "读取网页",
                      search_bangumi: "Bangumi 搜索",
                      search_anilist: "AniList 搜索",
                      propose_web_birthdays: "生日来源提案",
                      record_birthday_findings: "保存核实结论",
                      propose_bangumi_import: "关联提案",
                      apply_changes: "修改资料",
                      update_character_tags: "修改角色 Tag",
                    }[activity.name] || activity.name}
                  </span>
                  <p>{activity.detail}</p>
                  {!!activity.sources?.length && (
                    <details>
                      <summary>查看来源</summary>
                      {activity.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.title}
                        </a>
                      ))}
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
          {logs.map((log) => (
            <div className="operation-result" key={log.id}>
              <CheckCircle2 size={17} />
              <div>
                <strong>{log.summary}</strong>
                <span>{log.changes.length} 条变更已保存</span>
                {log.changes
                  .filter(
                    (change) =>
                      change.after &&
                      "birthdaySource" in change.after &&
                      change.after.birthdaySource.includes("通过 AI 网页检索"),
                  )
                  .map((change) => {
                    const character = change.after as Character;
                    const source =
                      character.birthdaySource.match(/https?:\/\/[^\s]+/)?.[0];
                    return (
                      <div
                        className="birthday-evidence"
                        key={`source-${change.id}`}
                      >
                        <strong>
                          {character.name} · {character.birthday?.month}月
                          {character.birthday?.day}日
                        </strong>
                        <p>{character.birthdaySource}</p>
                        {source && (
                          <a
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            查看生日来源
                          </a>
                        )}
                      </div>
                    );
                  })}
                <details>
                  <summary>查看变更</summary>
                  {log.changes.map((c) => (
                    <div key={c.id}>
                      <span>{c.id}</span>
                      <pre>
                        {JSON.stringify(
                          { before: c.before, after: c.after },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  ))}
                </details>
              </div>
              <button
                className="quiet-button"
                title="撤销本次操作"
                aria-label="撤销本次操作"
                disabled={log.undone || busy}
                onClick={() =>
                  void repository
                    .undo(log.id)
                    .then(() => {
                      setLogs((old) =>
                        old.map((item) =>
                          item.id === log.id ? { ...item, undone: true } : item,
                        ),
                      );
                      notify("已撤销");
                    })
                    .catch((e) => setError(e.message))
                }
              >
                <Undo2 size={17} />
                {log.undone ? "已撤销" : "撤销"}
              </button>
            </div>
          ))}
          {pending && (
            <>
              <ChangePreview pending={pending} />
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setRecoverable(false);
                    void clearAssistantCheckpoint();
                    void saveChat("assistant", "已取消待确认操作，没有写入。");
                  }}
                >
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  <Check size={16} />
                  确认应用
                </button>
              </div>
            </>
          )}
          <ErrorText error={error} />
          {!busy && recoverable && !pending && (
            <div className="assistant-recovery" aria-label="继续未完成操作">
              <strong>{recoveryInfo}</strong>
              <p>继续时复用已取得资料和操作进度；也可切换模型后继续。</p>
              <div className="button-row">
                <button className="primary" onClick={() => void send(true)}>
                  继续本次操作
                </button>
                <button
                  onClick={() => {
                    void clearAssistantCheckpoint();
                    setRecoverable(false);
                    setError("");
                  }}
                >
                  结束本次查询
                </button>
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
        <div className="assistant-input">
          <textarea
            aria-label="发送给 AI 助手"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="添加角色、节日或安排创作…"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>本机资料 · 不发送私人备注</span>
            {busy ? (
              <IconButton
                title="取消请求"
                onClick={() => controller.current?.abort()}
              >
                <Square size={17} />
              </IconButton>
            ) : (
              <IconButton
                className="send-button"
                title="发送"
                disabled={!text.trim() || !!pending}
                onClick={() => void send()}
              >
                <Send size={18} />
              </IconButton>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
