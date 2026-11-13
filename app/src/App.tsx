import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { call, inTauri } from "./api";
import { BridgeSetup } from "./BridgeSetup";
import { ChangesView, useChangeLog } from "./ChangesView";
import { ClubBrowser } from "./ClubBrowser";
import { CommandPalette, Keys, SearchIcon, type Command, type Found, type FoundKind } from "./CommandPalette";
import { CompatibilityNotice } from "./CompatibilityNotice";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { forgetFieldTables } from "./fieldTables";
import { describeError, describeGame, formatDate } from "./format";
import { FrozenNotice } from "./FrozenNotice";
import { GraphicsStatus } from "./GraphicsStatus";
import { SettingsMenu } from "./SettingsMenu";
import {
  appText,
  changesText,
  clubListText,
  homeText,
  paletteText,
  playerListText,
  scoutingText,
  staffListText,
  updateText,
} from "./labels";
import type { ListRequest } from "./ListBrowser";
import { PlayerBrowser } from "./PlayerBrowser";
import { restored, useSnapshot } from "./restore";
import { SaveChangedNotice, useSaveChanged } from "./SaveChangedNotice";
import { ScoutingBrowser } from "./ScoutingBrowser";
import { MyClub } from "./MyClub";
import { matches, SHORTCUTS, viewShortcut, withShortcut } from "./shortcuts";
import { StaffBrowser } from "./StaffBrowser";
import type {
  BridgeInfo,
  ClubSummary,
  ConnectionInfo,
  Detection,
  PlayerSummary,
  Refrozen,
  ReloadInfo,
  StaffSummary,
} from "./types";
import { useUpdateCheck } from "./update";
import { UpdateCheck, UpdateNotice } from "./UpdateNotice";
import { ComparisonContext, useComparison } from "./useComparison";
import { modalOpen, topModal } from "./useModal";
import { askToLeave, EditorContext, profileOnTop } from "./useProfileEditing";
import "./App.css";
import "./Comfort.css";

type View = "home" | "players" | "staff" | "clubs" | "scouting" | "changes";

const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: homeText.nav },
  { id: "players", label: playerListText.nav },
  { id: "staff", label: staffListText.nav },
  { id: "clubs", label: clubListText.nav },
  { id: "scouting", label: scoutingText.nav },
  { id: "changes", label: changesText.nav },
];