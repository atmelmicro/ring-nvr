import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RiArrowLeftLine,
  RiLogoutBoxLine,
  RiHardDrive2Line,
  RiWifiLine,
  RiCameraLine,
  RiShieldCheckLine,
  RiShieldLine,
  RiAlertLine,
  RiCheckLine,
  RiRefreshLine,
  RiLockLine,
  RiMailLine,
  RiBatteryLine,
  RiMapPinLine,
  RiCpuLine,
  RiTimeLine,
} from "@remixicon/react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RingStatus {
  authenticated: boolean;
  account_email: string | null;
  listener_running: boolean;
}

interface StorageStats {
  storage_path: string;
  disk_total_bytes: number;
  disk_used_bytes: number;
  disk_free_bytes: number;
  disk_used_percent: number;
  recordings_size_bytes: number;
  recordings_count: number;
}

interface RingDevice {
  id: number;
  device_id: string;
  name: string;
  model: string | null;
  family: string | null;
  firmware: string | null;
  battery_life: number | null;
  wifi_signal_strength: number | null;
  address: string | null;
}

interface RecordingSettings {
  autodelete_days: number;
  duration_seconds: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function familyLabel(family: string | null): string {
  if (!family) return "Device";
  return family.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

function StorageBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color =
    clamped >= 90
      ? "bg-destructive"
      : clamped >= 70
        ? "bg-amber-500"
        : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ─── Ring Login Form ──────────────────────────────────────────────────────────

type LoginStep = "credentials" | "2fa";

function RingLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      const res = await api.post<{ status: string }>(
        "/settings/ring/login",
        data,
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data.status === "2fa_required") {
        setStep("2fa");
        setError("");
      } else {
        onSuccess();
      }
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Login failed. Check your credentials.");
    },
  });

  const twoFaMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await api.post<{ status: string }>("/settings/ring/2fa", {
        code,
      });
      return res.data;
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(detail ?? "Invalid 2FA code. Please try again.");
    },
  });

  const handleCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  };

  const handleOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    twoFaMutation.mutate(otp);
  };

  if (step === "2fa") {
    return (
      <form onSubmit={handleOtp} className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Ring sent a verification code to your email or phone. Enter it below.
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
            <RiAlertLine className="mt-0.5 size-3.5 shrink-0" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="otp">Verification code</Label>
          <Input
            id="otp"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="123456"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStep("credentials");
              setOtp("");
              setError("");
            }}
          >
            Back
          </Button>
          <Button
            type="submit"
            size="sm"
            className="flex-1"
            disabled={twoFaMutation.isPending}
          >
            {twoFaMutation.isPending ? "Verifying…" : "Verify"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleCredentials} className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          <RiAlertLine className="mt-0.5 size-3.5 shrink-0" />
          <span className="text-xs">{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="ring-email">Ring account email</Label>
        <div className="relative">
          <RiMailLine className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            id="ring-email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-7"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ring-password">Password</Label>
        <div className="relative">
          <RiLockLine className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            id="ring-password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-7"
            required
          />
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        className="w-full"
        disabled={loginMutation.isPending}
      >
        {loginMutation.isPending ? "Signing in…" : "Sign in to Ring"}
      </Button>
    </form>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const queryClient = useQueryClient();

  // Local state for the autodelete input (kept as string for free-form editing)
  const [autodeleteInput, setAutodeleteInput] = useState<string>("");
  const [autodeleteEditing, setAutodeleteEditing] = useState(false);

  // Ring status
  const {
    data: ringStatus,
    isLoading: ringStatusLoading,
    refetch: refetchRingStatus,
  } = useQuery({
    queryKey: ["ring-status"],
    queryFn: async () => {
      const res = await api.get<RingStatus>("/settings/ring/status");
      return res.data;
    },
  });

  // Storage stats
  const {
    data: storage,
    isLoading: storageLoading,
    refetch: refetchStorage,
  } = useQuery({
    queryKey: ["storage-stats"],
    queryFn: async () => {
      const res = await api.get<StorageStats>("/settings/storage");
      return res.data;
    },
  });

  // Devices – only fetch when Ring is authenticated
  const {
    data: devices,
    isLoading: devicesLoading,
    refetch: refetchDevices,
  } = useQuery({
    queryKey: ["ring-devices"],
    queryFn: async () => {
      const res = await api.get<RingDevice[]>("/settings/devices");
      return res.data;
    },
    enabled: !!ringStatus?.authenticated,
    retry: false,
  });

  // Ring logout mutation
  const ringLogoutMutation = useMutation({
    mutationFn: async () => {
      await api.post("/settings/ring/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ring-status"] });
      queryClient.invalidateQueries({ queryKey: ["ring-devices"] });
    },
  });

  const handleLoginSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["ring-status"] });
    queryClient.invalidateQueries({ queryKey: ["ring-devices"] });
  };

  // Recording settings
  const { data: recordingSettings, isLoading: recordingSettingsLoading } =
    useQuery({
      queryKey: ["recording-settings"],
      queryFn: async () => {
        const res = await api.get<RecordingSettings>("/settings/recording");
        return res.data;
      },
    });

  const recordingSettingsMutation = useMutation({
    mutationFn: async (settings: RecordingSettings) => {
      const res = await api.put<RecordingSettings>(
        "/settings/recording",
        settings,
      );
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["recording-settings"], data);
      setAutodeleteEditing(false);
    },
  });

  const handleAutodeleteBlurOrSave = () => {
    if (!recordingSettings) return;
    const parsed = parseInt(autodeleteInput, 10);
    if (
      !isNaN(parsed) &&
      parsed >= 0 &&
      parsed !== recordingSettings.autodelete_days
    ) {
      recordingSettingsMutation.mutate({
        ...recordingSettings,
        autodelete_days: parsed,
      });
    } else {
      setAutodeleteEditing(false);
    }
  };

  const startAutodeleteEdit = () => {
    if (!recordingSettings) return;
    setAutodeleteInput(String(recordingSettings.autodelete_days));
    setAutodeleteEditing(true);
  };

  const refreshAll = () => {
    refetchRingStatus();
    refetchStorage();
    if (ringStatus?.authenticated) refetchDevices();
    queryClient.invalidateQueries({ queryKey: ["recording-settings"] });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("/")}
              aria-label="Back to dashboard"
            >
              <RiArrowLeftLine />
            </Button>
            <span className="text-sm font-semibold tracking-tight">
              Settings
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={refreshAll}
              aria-label="Refresh"
            >
              <RiRefreshLine />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              aria-label="Log out of NVR"
            >
              <RiLogoutBoxLine />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 space-y-6">
        {/* ── Ring Account ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <RiShieldCheckLine className="size-4" />
                </span>
                <div>
                  <CardTitle className="text-sm">Ring Account</CardTitle>
                  <CardDescription className="text-xs">
                    Connect your Ring account to enable live recording.
                  </CardDescription>
                </div>
              </div>

              {ringStatusLoading ? (
                <Skeleton className="h-5 w-20 rounded-full" />
              ) : ringStatus?.authenticated ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                >
                  <RiCheckLine className="size-3" />
                  Connected
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs border-muted-foreground/30 text-muted-foreground"
                >
                  <RiShieldLine className="size-3" />
                  Not connected
                </Badge>
              )}
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="pt-4 space-y-4">
            {ringStatusLoading ? (
              <SectionSkeleton rows={2} />
            ) : ringStatus?.authenticated ? (
              <>
                {/* Account info */}
                <div className="space-y-2">
                  {ringStatus.account_email && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">
                        Account
                      </span>
                      <span className="text-xs font-medium">
                        {ringStatus.account_email}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">
                      Listener
                    </span>
                    <Badge
                      variant="secondary"
                      className={`text-xs gap-1 ${ringStatus.listener_running ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : ""}`}
                    >
                      {ringStatus.listener_running ? (
                        <>
                          <span className="relative flex size-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full size-1.5 bg-emerald-500" />
                          </span>
                          Active
                        </>
                      ) : (
                        "Inactive"
                      )}
                    </Badge>
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  disabled={ringLogoutMutation.isPending}
                  onClick={() => ringLogoutMutation.mutate()}
                >
                  <RiLogoutBoxLine className="size-3.5" />
                  {ringLogoutMutation.isPending
                    ? "Disconnecting…"
                    : "Disconnect Ring account"}
                </Button>
              </>
            ) : (
              <RingLoginForm onSuccess={handleLoginSuccess} />
            )}
          </CardContent>
        </Card>

        {/* ── Storage ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RiHardDrive2Line className="size-4" />
              </span>
              <div>
                <CardTitle className="text-sm">Storage</CardTitle>
                <CardDescription className="text-xs">
                  Disk usage and recordings directory.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="pt-4 space-y-4">
            {storageLoading ? (
              <SectionSkeleton rows={4} />
            ) : storage ? (
              <>
                {/* Disk bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Disk usage
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {storage.disk_used_percent}%
                    </span>
                  </div>
                  <StorageBar percent={storage.disk_used_percent} />
                  <div className="flex items-center justify-between text-[0.65rem] text-muted-foreground tabular-nums">
                    <span>{formatBytes(storage.disk_used_bytes)} used</span>
                    <span>{formatBytes(storage.disk_free_bytes)} free</span>
                    <span>{formatBytes(storage.disk_total_bytes)} total</span>
                  </div>
                </div>

                <Separator />

                {/* Recordings stats */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Recordings size
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {formatBytes(storage.recordings_size_bytes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Total recordings
                    </span>
                    <span className="text-xs font-medium tabular-nums">
                      {storage.recordings_count.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Storage path
                    </span>
                    <span className="text-[0.65rem] font-mono text-muted-foreground truncate max-w-[55%] text-right">
                      {storage.storage_path}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Failed to load storage stats.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Recording Settings ────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RiTimeLine className="size-4" />
              </span>
              <div>
                <CardTitle className="text-sm">Recording</CardTitle>
                <CardDescription className="text-xs">
                  Automatic cleanup and recording behaviour.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="pt-4 space-y-4">
            {recordingSettingsLoading ? (
              <SectionSkeleton rows={2} />
            ) : recordingSettings ? (
              <>
                {/* Autodelete row */}
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">Auto-delete after</p>
                    <p className="text-[0.65rem] text-muted-foreground">
                      Recordings older than this are permanently deleted. Set
                      to&nbsp;0 to disable.
                    </p>
                  </div>

                  {autodeleteEditing ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        className="h-7 w-16 text-xs text-right tabular-nums"
                        value={autodeleteInput}
                        autoFocus
                        onChange={(e) => setAutodeleteInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAutodeleteBlurOrSave();
                          if (e.key === "Escape") setAutodeleteEditing(false);
                        }}
                        onBlur={handleAutodeleteBlurOrSave}
                        disabled={recordingSettingsMutation.isPending}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        days
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startAutodeleteEdit}
                      className="flex items-center gap-1 shrink-0 rounded px-2 py-1 text-xs font-medium tabular-nums hover:bg-muted transition-colors"
                      title="Click to edit"
                    >
                      {recordingSettings.autodelete_days === 0 ? (
                        <span className="text-muted-foreground">Disabled</span>
                      ) : (
                        <>
                          {recordingSettings.autodelete_days}
                          <span className="text-muted-foreground font-normal">
                            days
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {recordingSettingsMutation.isError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <RiAlertLine className="size-3 shrink-0" />
                    Failed to save. Please try again.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Failed to load recording settings.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Devices ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <RiCameraLine className="size-4" />
              </span>
              <div>
                <CardTitle className="text-sm">Ring Devices</CardTitle>
                <CardDescription className="text-xs">
                  Cameras and doorbells linked to your Ring account.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <Separator />

          <CardContent className="pt-4">
            {!ringStatus?.authenticated ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                <RiShieldLine className="size-8 opacity-20" />
                <p className="text-xs">
                  Connect your Ring account to see devices.
                </p>
              </div>
            ) : devicesLoading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded-lg border border-border p-3"
                  >
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                ))}
              </div>
            ) : devices && devices.length > 0 ? (
              <div className="space-y-3">
                {devices.map((device) => (
                  <div
                    key={device.device_id}
                    className="rounded-lg border border-border bg-card p-3 space-y-2"
                  >
                    {/* Device header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <RiCameraLine className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-xs font-medium truncate">
                          {device.name}
                        </span>
                      </div>
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-xs capitalize"
                      >
                        {familyLabel(device.family)}
                      </Badge>
                    </div>

                    {/* Device details grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[0.65rem]">
                      {device.model && (
                        <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                          <RiCpuLine className="size-3 shrink-0" />
                          <span className="truncate">{device.model}</span>
                        </div>
                      )}
                      {device.firmware && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <span className="opacity-60">FW</span>
                          <span className="font-mono truncate">
                            {device.firmware}
                          </span>
                        </div>
                      )}
                      {device.battery_life !== null &&
                        device.battery_life !== undefined && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <RiBatteryLine className="size-3 shrink-0" />
                            <span>{device.battery_life}%</span>
                          </div>
                        )}
                      {device.wifi_signal_strength !== null &&
                        device.wifi_signal_strength !== undefined && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <RiWifiLine className="size-3 shrink-0" />
                            <span>{device.wifi_signal_strength} dBm</span>
                          </div>
                        )}
                      {device.address && (
                        <div className="flex items-center gap-1 text-muted-foreground col-span-2">
                          <RiMapPinLine className="size-3 shrink-0" />
                          <span className="truncate">{device.address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
                <RiCameraLine className="size-8 opacity-20" />
                <p className="text-xs">No devices found on this account.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
