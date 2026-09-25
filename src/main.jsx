import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Convert from "ansi-to-html";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  CornerDownLeft,
  FileText,
  Info,
  KeyRound,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Moon,
  Send,
  SquareTerminal,
  Sun,
  SunMoon,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import "./styles.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}

const attentionStatuses = new Set(["blocked", "done", "unknown"]);
const ansiOptions = {
  bg: "transparent",
  fg: "currentColor",
  newline: true,
  escapeXML: true,
  stream: false
};
// The 16 basic ANSI colours default to a dark-terminal palette (bright yellow,
// white) that vanishes on a light reader, so light mode gets darker shades.
// Truecolor output from agents is emitted inline and passes through untouched.
const ansiConverters = {
  dark: new Convert(ansiOptions),
  light: new Convert({
    ...ansiOptions,
    colors: {
      0: "#1f262b", 1: "#b42323", 2: "#1d7a35", 3: "#8a6200",
      4: "#2450b8", 5: "#9030a0", 6: "#0b7a86", 7: "#5d6974",
      8: "#6b7680", 9: "#d13b3b", 10: "#25913f", 11: "#9c7400",
      12: "#2d6bd2", 13: "#a63db5", 14: "#0e8d99", 15: "#1b2226"
    }
  })
};

const THEME_KEY = "herdrrmt-theme";
const themeOrder = ["system", "light", "dark"];
const themeBackgrounds = { dark: "#0f1113", light: "#f4f6f8" };

function readThemePref() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return themeOrder.includes(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

// "system" leaves data-theme unset so the CSS prefers-color-scheme block
// decides; an explicit pick stamps data-theme on <html> (index.html does the
// same before first paint to avoid a dark flash).
function useTheme() {
  const [pref, setPref] = useState(readThemePref);
  const [systemLight, setSystemLight] = useState(() => window.matchMedia("(prefers-color-scheme: light)").matches);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (event) => setSystemLight(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved = pref === "system" ? (systemLight ? "light" : "dark") : pref;

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      if (pref === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
    } catch {
      // Storage blocked (private mode); the theme still applies for this visit.
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeBackgrounds[resolved]);
  }, [pref, resolved]);

  function cycleTheme() {
    setPref((current) => themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length]);
  }

  return { pref, resolved, cycleTheme };
}

function authHeaders(token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

function StatusBadge({ status }) {
  const value = status || "unknown";
  return <span className={`badge ${value}`}>{value}</span>;
}

function workspaceName(workspace) {
  return workspace?.label || workspace?.workspace_id || "Workspace";
}

function tabName(tab) {
  return tab?.label ? `Tab ${tab.label}` : `Tab ${tab?.number ?? "?"}`;
}

function attentionCountForWorkspace(workspace, agents) {
  return agents.filter((agent) => agent.workspace_id === workspace.workspace_id && attentionStatuses.has(agent.agent_status)).length;
}

function terminalHtml(value, theme) {
  return (ansiConverters[theme] || ansiConverters.dark).toHtml(value || "");
}

function Sidebar({ snapshot, selectedTabId, onClose, onCreateWorkspace, onCreateTab, onSelectTab, onRefresh, busy, onToken, themePref, onCycleTheme }) {
  const workspaces = snapshot?.workspaces || [];
  const tabs = snapshot?.tabs || [];
  const agents = snapshot?.agents || [];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-copy">
          <h1>Herdrrmt</h1>
          <p>{snapshot?.status?.server?.running ? `Herdr ${snapshot.status.server.version}` : "Connecting"}</p>
        </div>
        <div className="icon-actions">
          <button type="button" onClick={onCreateWorkspace} title="New workspace" aria-label="New workspace">
            <Plus size={16} />
          </button>
          <button type="button" onClick={onClose} title="Close sidebar" aria-label="Close sidebar">
            <X size={16} />
          </button>
          <button type="button" className="btn-theme-toggle" onClick={onCycleTheme} title={`Theme: ${themePref}`} aria-label={`Theme: ${themePref}`}>
            {themePref === "light" ? <Sun size={16} /> : themePref === "dark" ? <Moon size={16} /> : <SunMoon size={16} />}
          </button>
          <button type="button" onClick={onToken} title="Set token" aria-label="Set token">
            <KeyRound size={16} />
          </button>
          <button type="button" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <nav className="workspace-nav">
        {workspaces.map((workspace) => {
          const workspaceTabs = tabs.filter((tab) => tab.workspace_id === workspace.workspace_id);
          const attentionCount = attentionCountForWorkspace(workspace, agents);
          return (
            <section className="workspace-group" key={workspace.workspace_id}>
              <div className="workspace-heading">
                <div className="workspace-title">
                  <span className="workspace-number">{workspace.number}</span>
                  <span className={`status-dot ${workspace.agent_status || "unknown"}`} />
                  <span>{workspaceName(workspace)}</span>
                </div>
                <div className="workspace-meta">
                  {attentionCount > 0 ? <span className="attention-dot">{attentionCount}</span> : null}
                  <StatusBadge status={workspace.agent_status} />
                  <button
                    type="button"
                    className="workspace-add-button"
                    onClick={() => onCreateTab(workspace.workspace_id)}
                    title={`New tab in ${workspaceName(workspace)}`}
                    aria-label={`New tab in ${workspaceName(workspace)}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <div className="tab-list">
                {workspaceTabs.map((tab) => {
                  const selected = tab.tab_id === selectedTabId;
                  return (
                    <button
                      className={`tab-link ${selected ? "selected" : ""}`}
                      type="button"
                      key={tab.tab_id}
                      onClick={() => onSelectTab(tab.tab_id)}
                      title={`${workspaceName(workspace)} · ${tabName(tab)} · ${tab.agent_status || "unknown"}`}
                    >
                      <span className="collapsed-tab-number">{tab.number}</span>
                      <span className="tab-main">
                        <span className="tab-name"><span className={`status-dot ${tab.agent_status || "unknown"}`} />{tabName(tab)}</span>
                        <span className="tab-id">{tab.tab_id}</span>
                      </span>
                      <StatusBadge status={tab.agent_status} />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

function PaneSelector({ panes, selectedPaneId, onSelectPane }) {
  if (panes.length <= 1) {
    return null;
  }

  return (
    <select className="pane-select" value={selectedPaneId || ""} onChange={(event) => onSelectPane(event.target.value)}>
      {panes.map((pane) => (
        <option value={pane.pane_id} key={pane.pane_id}>
          {pane.pane_id} · {pane.agent || "shell"} · {pane.agent_status || "unknown"}
        </option>
      ))}
    </select>
  );
}

function WorkspaceTicker({ workspaces, tabs, onSelectTab }) {
  return (
    <div className="workspace-ticker" aria-label="Workspace status ticker">
      <div className="ticker-track">
        {workspaces.map((workspace) => {
          const activeTab = tabs.find((tab) => tab.tab_id === workspace.active_tab_id);
          const status = workspace.agent_status || "unknown";
          return (
            <button
              type="button"
              className="ticker-item"
              key={workspace.workspace_id}
              onClick={() => activeTab && onSelectTab(activeTab.tab_id)}
              title={`${workspaceName(workspace)} · ${status}`}
            >
              <span className={`status-dot ${status}`} />
              <span className="ticker-name">{workspaceName(workspace)}</span>
              <span className="ticker-status">{status}</span>
            </button>
          );
        })}
        {workspaces.map((workspace) => {
          const activeTab = tabs.find((tab) => tab.tab_id === workspace.active_tab_id);
          const status = workspace.agent_status || "unknown";
          return (
            <button
              type="button"
              className="ticker-item"
              key={`${workspace.workspace_id}-clone`}
              onClick={() => activeTab && onSelectTab(activeTab.tab_id)}
              tabIndex={-1}
              aria-hidden="true"
            >
              <span className={`status-dot ${status}`} />
              <span className="ticker-name">{workspaceName(workspace)}</span>
              <span className="ticker-status">{status}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttentionStrip({ agents, workspaces, onSelectTab, onRead }) {
  const attention = agents.filter((agent) => attentionStatuses.has(agent.agent_status));
  if (!attention.length) {
    return null;
  }

  return (
    <div className="attention-strip">
      {attention.map((agent) => {
        const workspace = workspaces.find((item) => item.workspace_id === agent.workspace_id);
        return (
          <button type="button" className="attention-item" key={agent.pane_id} onClick={() => onSelectTab(agent.tab_id)}>
            <span>{workspaceName(workspace)}</span>
            <StatusBadge status={agent.agent_status} />
            <FileText size={14} onClick={(event) => {
              event.stopPropagation();
              onRead(agent.pane_id);
            }} />
          </button>
        );
      })}
    </div>
  );
}

function MainPanel({
  snapshot,
  selectedTab,
  selectedWorkspace,
  tabPanes,
  selectedPaneId,
  setSelectedPaneId,
  transcript,
  autoRead,
  setAutoRead,
  streamState,
  onOpenSidebar,
  onSelectTab,
  onRead,
  onExplain,
  onSubmit,
  onRun,
  onKey,
  theme
}) {
  const [draft, setDraft] = useState("");
  const [command, setCommand] = useState("");
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const terminalRef = useRef(null);
  const promptRef = useRef(null);
  // Auto-read replaces the <pre> innerHTML every ~2s, which resets scrollTop.
  // Track whether the reader was pinned to the bottom (and where it sat) so a
  // refresh keeps live-tailing without yanking a user out of scrollback.
  const scrollStateRef = useRef({ pinned: true, top: 0 });

  function recordScrollState() {
    const node = terminalRef.current;
    if (!node) return;
    scrollStateRef.current = {
      pinned: node.scrollHeight - node.scrollTop - node.clientHeight <= 40,
      top: node.scrollTop
    };
  }

  useLayoutEffect(() => {
    const node = terminalRef.current;
    if (!node) return;
    const { pinned, top } = scrollStateRef.current;
    if (pinned) {
      node.scrollTop = node.scrollHeight;
    } else {
      node.scrollTop = top;
    }
  }, [transcript]);

  const selectedPane = tabPanes.find((pane) => pane.pane_id === selectedPaneId) || tabPanes[0];

  // Ctrl armed for one pane must never fire into another (ctrl+c / ctrl+d).
  useEffect(() => {
    setCtrlArmed(false);
  }, [selectedPane?.pane_id]);
  const canSend = Boolean(selectedPane?.pane_id);
  const canSubmitDraft = canSend && Boolean(draft.trim());
  const canRunCommand = canSend && Boolean(command.trim());
  const selectedLabel = [
    selectedWorkspace ? workspaceName(selectedWorkspace) : "No workspace",
    selectedTab ? tabName(selectedTab) : "No tab",
    selectedPane?.pane_id || "No pane"
  ].join(" / ");
  const selectedStatus = selectedPane?.agent_status || selectedTab?.agent_status || "unknown";

  async function submitDraft() {
    if (!selectedPane || !draft.trim()) return;
    await onSubmit(selectedPane.pane_id, draft);
    setDraft("");
  }

  async function runCommand() {
    if (!selectedPane || !command.trim()) return;
    await onRun(selectedPane.pane_id, command);
    setCommand("");
    setShellOpen(false);
  }

  function sendKey(key) {
    if (!selectedPane) return;
    onKey(selectedPane.pane_id, key);
  }

  // Ctrl is a sticky modifier: arm it, then the next letter typed into the
  // agent input goes out as ctrl+<letter> instead of landing in the draft.
  function toggleCtrl() {
    const next = !ctrlArmed;
    setCtrlArmed(next);
    if (next) promptRef.current?.focus();
  }

  function handleDraftChange(event) {
    const { value, selectionStart } = event.target;
    if (ctrlArmed) {
      // Any input disarms Ctrl; only a single typed letter becomes a chord, so
      // a stray digit or space can't leave it armed to eat a later letter.
      setCtrlArmed(false);
      const letter = value.length === draft.length + 1 ? value[selectionStart - 1] || "" : "";
      if (selectedPane && /^[a-z]$/i.test(letter)) {
        sendKey(`ctrl+${letter.toLowerCase()}`);
        return;
      }
    }
    setDraft(value);
  }

  return (
    <main className="main">
      <header className="main-header">
        <div className="main-heading">
          <button type="button" className="open-sidebar-button" onClick={onOpenSidebar} title="Open workspaces" aria-label="Open workspaces">
            <PanelLeftOpen size={16} />
          </button>
          <div className="selected-meta">
            <div className="selected-line">
              <span className={`status-dot ${selectedStatus}`} />
              <span className="selected-title">{selectedLabel}</span>
              <span className="selected-path">{selectedPane?.cwd || selectedWorkspace?.label || ""}</span>
            </div>
          </div>
        </div>
        <div className="header-controls">
          <PaneSelector panes={tabPanes} selectedPaneId={selectedPane?.pane_id || ""} onSelectPane={setSelectedPaneId} />
          <span className="stream-state">{streamState}</span>
          <div className="actions compact-actions">
            <button type="button" onClick={() => setAutoRead(!autoRead)} disabled={!canSend} title={autoRead ? "Pause auto-read" : "Start auto-read"} aria-label={autoRead ? "Pause auto-read" : "Start auto-read"}>
              {autoRead ? <WifiOff size={16} /> : <Wifi size={16} />}
            </button>
            <button type="button" onClick={() => selectedPane && onRead(selectedPane.pane_id)} disabled={!canSend} title="Read active pane" aria-label="Read active pane">
              <FileText size={16} />
            </button>
            <button type="button" onClick={() => selectedPane && onExplain(selectedPane.pane_id)} disabled={!canSend} title="Explain agent status" aria-label="Explain agent status">
              <Info size={16} />
            </button>
            <button type="button" className="btn-shell-drawer" onClick={() => setShellOpen(true)} disabled={!canSend} title="Shell command" aria-label="Shell command">
              <SquareTerminal size={16} />
            </button>
          </div>
        </div>
      </header>

      <WorkspaceTicker
        workspaces={snapshot?.workspaces || []}
        tabs={snapshot?.tabs || []}
        onSelectTab={onSelectTab}
      />

      <section className="reader-panel">
        <pre
          className="terminal"
          ref={terminalRef}
          onScroll={recordScrollState}
          dangerouslySetInnerHTML={{
            __html: transcript ? terminalHtml(transcript, theme) : "Select a tab to stream the active pane."
          }}
        />
      </section>

      <section className="keypad">
        <button type="button" className="btn-key btn-key-esc" disabled={!canSend} title="Escape" aria-label="Escape" onClick={() => sendKey("Escape")}>
          <span className="btn-key-label">Esc</span>
        </button>
        <button type="button" className="btn-key btn-key-left" disabled={!canSend} title="Arrow left" aria-label="Arrow left" onClick={() => sendKey("Left")}>
          <ArrowLeft size={18} />
        </button>
        <button type="button" className="btn-key btn-key-up" disabled={!canSend} title="Arrow up" aria-label="Arrow up" onClick={() => sendKey("Up")}>
          <ArrowUp size={18} />
        </button>
        <button type="button" className="btn-key btn-key-down" disabled={!canSend} title="Arrow down" aria-label="Arrow down" onClick={() => sendKey("Down")}>
          <ArrowDown size={18} />
        </button>
        <button type="button" className="btn-key btn-key-right" disabled={!canSend} title="Arrow right" aria-label="Arrow right" onClick={() => sendKey("Right")}>
          <ArrowRight size={18} />
        </button>
        <button type="button" className="btn-key btn-key-tab" disabled={!canSend} title="Tab" aria-label="Tab" onClick={() => sendKey("Tab")}>
          <ArrowRightToLine size={18} />
        </button>
        <button
          type="button"
          className={`btn-key btn-key-ctrl ${ctrlArmed ? "armed" : ""}`}
          disabled={!canSend}
          title="Ctrl — then type a letter"
          aria-label="Ctrl"
          aria-pressed={ctrlArmed}
          onClick={toggleCtrl}
        >
          <span className="btn-key-label">Ctrl</span>
        </button>
        <button type="button" className="btn-key btn-key-return" disabled={!canSend} title="Return" aria-label="Return" onClick={() => sendKey("Enter")}>
          <CornerDownLeft size={18} />
        </button>
      </section>

      <section className="composer">
        <div className="composer-block">
          <div className="prompt-row">
            <textarea
              id="prompt"
              ref={promptRef}
              value={draft}
              aria-label="Agent input"
              placeholder={ctrlArmed ? "Ctrl armed: type a letter" : "Send text to the selected pane"}
              enterKeyHint="send"
              autoCapitalize="off"
              onChange={handleDraftChange}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submitDraft();
              }}
            />
            <button
              type="button"
              className="btn-submit-agent"
              disabled={!canSubmitDraft}
              onClick={submitDraft}
              title="Submit to agent"
              aria-label="Submit to agent"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

      </section>

      {shellOpen ? (
        <>
          <div className="shell-drawer-backdrop" onClick={() => setShellOpen(false)} />
          <section className="shell-drawer" role="dialog" aria-label="Shell command">
            <div className="shell-drawer-header">
              <label htmlFor="command">Shell command</label>
              <button type="button" className="shell-drawer-close" onClick={() => setShellOpen(false)} title="Close" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="command-row">
              <input
                id="command"
                value={command}
                placeholder="Run in selected pane"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setShellOpen(false);
                    return;
                  }
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  runCommand();
                }}
              />
              <button
                type="button"
                className="btn-run-command"
                disabled={!canRunCommand}
                onClick={runCommand}
              >
                <Play size={16} />
                Run
              </button>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("herdrrmt-token") || "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTabId, setSelectedTabId] = useState("");
  const [selectedPaneId, setSelectedPaneId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoRead, setAutoRead] = useState(true);
  const [streamState, setStreamState] = useState("idle");
  const streamRef = useRef(null);
  const { pref: themePref, resolved: theme, cycleTheme } = useTheme();

  const selectedTab = useMemo(() => {
    return snapshot?.tabs?.find((tab) => tab.tab_id === selectedTabId) || null;
  }, [snapshot, selectedTabId]);

  const selectedWorkspace = useMemo(() => {
    if (!selectedTab) return null;
    return snapshot?.workspaces?.find((workspace) => workspace.workspace_id === selectedTab.workspace_id) || null;
  }, [snapshot, selectedTab]);

  const tabPanes = useMemo(() => {
    if (!selectedTab) return [];
    return (snapshot?.panes || []).filter((pane) => pane.tab_id === selectedTab.tab_id);
  }, [snapshot, selectedTab]);

  async function refresh() {
    setBusy(true);
    try {
      const next = await request("/api/snapshot", token);
      setSnapshot(next);
      setError("");
      if (!selectedTabId) {
        const focused = next.tabs.find((tab) => tab.focused) || next.tabs[0];
        if (focused) setSelectedTabId(focused.tab_id);
      }
    } catch (err) {
      if (err.status === 401) promptToken();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function promptToken() {
    const next = window.prompt("Herdr remote token", token);
    if (next === null) return;
    const trimmed = next.trim();
    setToken(trimmed);
    if (trimmed) localStorage.setItem("herdrrmt-token", trimmed);
    else localStorage.removeItem("herdrrmt-token");
  }

  async function selectTab(tabId) {
    setSelectedTabId(tabId);
    setSidebarOpen(false);
    const next = await request("/api/tab/focus", token, {
      method: "POST",
      body: JSON.stringify({ tab_id: tabId })
    });
    setSnapshot(next);
    const pane = next.panes.find((item) => item.tab_id === tabId);
    if (pane) {
      setSelectedPaneId(pane.pane_id);
      await readAgent(pane.pane_id);
    }
  }

  function selectFocusedTab(next) {
    const focused = next.tabs.find((tab) => tab.focused) || next.tabs[0];
    if (!focused) return;
    setSelectedTabId(focused.tab_id);
    const pane = next.panes.find((item) => item.tab_id === focused.tab_id);
    if (pane) setSelectedPaneId(pane.pane_id);
  }

  async function createWorkspace() {
    const next = await request("/api/workspace/create", token, {
      method: "POST",
      body: JSON.stringify({})
    });
    setSnapshot(next);
    selectFocusedTab(next);
    setSidebarOpen(false);
  }

  async function createTab(workspaceId) {
    const next = await request("/api/tab/create", token, {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspaceId })
    });
    setSnapshot(next);
    selectFocusedTab(next);
    setSidebarOpen(false);
  }

  async function readAgent(target) {
    setTranscript("Loading...");
    const result = await request("/api/agent/read", token, {
      method: "POST",
      body: JSON.stringify({ target, lines: 220, format: "ansi" })
    });
    setTranscript(result.read?.text || "No output.");
  }

  async function explainAgent(target) {
    setTranscript("Loading...");
    const result = await request("/api/agent/explain", token, {
      method: "POST",
      body: JSON.stringify({ target })
    });
    setTranscript(JSON.stringify(result, null, 2));
  }

  async function submitToPane(paneId, text) {
    const result = await request("/api/pane/submit", token, {
      method: "POST",
      body: JSON.stringify({ pane_id: paneId, text, format: "ansi" })
    });
    setTranscript(result.read?.text || "Submitted.");
    await refresh();
  }

  async function sendKeyToPane(paneId, key) {
    const result = await request("/api/pane/keys", token, {
      method: "POST",
      body: JSON.stringify({ pane_id: paneId, key, format: "ansi" })
    });
    setTranscript(result.read?.text || "Key sent.");
  }

  async function runInPane(paneId, command) {
    const result = await request("/api/pane/run", token, {
      method: "POST",
      body: JSON.stringify({ pane_id: paneId, command, format: "ansi" })
    });
    setTranscript(result.read?.text || "Command sent.");
    await refresh();
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 10000);
    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    const firstPane = tabPanes[0];
    if (firstPane && !tabPanes.some((pane) => pane.pane_id === selectedPaneId)) {
      setSelectedPaneId(firstPane.pane_id);
    }
  }, [tabPanes, selectedPaneId]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }

    if (!autoRead || sidebarOpen || !selectedPaneId) {
      setStreamState(sidebarOpen ? "paused while browsing" : "idle");
      return undefined;
    }

    const params = new URLSearchParams({
      target: selectedPaneId,
      lines: "220",
      intervalMs: "2000",
      format: "ansi"
    });
    if (token) params.set("access_token", token);
    const source = new EventSource(`/api/agent/stream?${params.toString()}`);
    streamRef.current = source;
    setStreamState("connecting");

    source.addEventListener("open", () => setStreamState("live"));
    source.addEventListener("read", (event) => {
      const result = JSON.parse(event.data);
      setTranscript(result.read?.text || "");
      setStreamState("live");
    });
    source.addEventListener("error", () => setStreamState("reconnecting"));

    return () => {
      source.close();
    };
  }, [autoRead, sidebarOpen, selectedPaneId, token]);

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
      {sidebarOpen ? (
        <Sidebar
          snapshot={snapshot}
          selectedTabId={selectedTabId}
          onClose={() => setSidebarOpen(false)}
          onCreateWorkspace={createWorkspace}
          onCreateTab={createTab}
          onSelectTab={selectTab}
          onRefresh={refresh}
          busy={busy}
          themePref={themePref}
          onCycleTheme={cycleTheme}
          onToken={() => {
            promptToken();
            refresh();
          }}
        />
      ) : null}

      <MainPanel
        snapshot={snapshot}
        selectedTab={selectedTab}
        selectedWorkspace={selectedWorkspace}
        tabPanes={tabPanes}
        selectedPaneId={selectedPaneId}
        setSelectedPaneId={(paneId) => {
          setSelectedPaneId(paneId);
        }}
        transcript={error || transcript}
        autoRead={autoRead}
        setAutoRead={setAutoRead}
        streamState={streamState}
        onOpenSidebar={() => setSidebarOpen(true)}
        onSelectTab={selectTab}
        onRead={readAgent}
        onExplain={explainAgent}
        onSubmit={submitToPane}
        onRun={runInPane}
        onKey={sendKeyToPane}
        theme={theme}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
