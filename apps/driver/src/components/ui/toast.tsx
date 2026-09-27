import * as React from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleAlert, CircleCheck, Info } from "lucide-react-native";

import { Text } from "./text";

/**
 * The web's sonner `<Toaster position="top-center" />` and `toast.*`,
 * without sonner: a context that holds the stack and a host that draws it
 * at the top of the screen, under the status bar.
 *
 * `useToast()` hands back stable functions, so a mutation's `onSuccess` can
 * close over them without re-subscribing. Each toast auto-dismisses after
 * 3.5 s (sonner's default is 4 s; the driver is walking to a door and a
 * message that lingers covers the thing they are about to tap) and a tap
 * dismisses it early.
 */
export type ToastKind = "success" | "error" | "info";

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
}

const TOAST_MS = 3500;
const MAX_VISIBLE = 3;

const ToastContext = React.createContext<ToastApi | null>(null);
const ToastStackContext = React.createContext<{
  toasts: readonly ToastRecord[];
  dismiss: (id: number) => void;
}>({ toasts: [], dismiss: () => undefined });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<readonly ToastRecord[]>([]);
  const nextId = React.useRef(1);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      // Newest on top; anything past the cap goes rather than stacking off
      // the bottom of the screen.
      setToasts((current) => [{ id, kind, message }, ...current].slice(0, MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );
  const stack = React.useMemo(() => ({ toasts, dismiss }), [toasts, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      <ToastStackContext.Provider value={stack}>
        {children}
        <Toaster />
      </ToastStackContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = React.useContext(ToastContext);
  if (!api) throw new Error("useToast() needs a <ToastProvider> above it.");
  return api;
}

const ICON: Record<ToastKind, { Icon: typeof Info; color: string }> = {
  success: { Icon: CircleCheck, color: "#199446" },
  error: { Icon: CircleAlert, color: "#dc2828" },
  info: { Icon: Info, color: "#1e9dcb" },
};

/**
 * The host. `ToastProvider` mounts one; only render it yourself if you have
 * a reason to draw the stack somewhere else (a second one draws every toast
 * twice).
 */
export function Toaster() {
  const { toasts, dismiss } = React.useContext(ToastStackContext);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      testID="toaster"
      className="absolute inset-x-0 top-0 items-center gap-2 px-4"
      style={{ paddingTop: insets.top + 8 }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
      ))}
    </View>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  // A lazily-initialised state slot rather than a ref: the driver value is
  // read during render (as the style), which the refs lint forbids of a ref.
  const [t] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    Animated.timing(t, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [t]);
  const { Icon, color } = ICON[toast.kind];
  return (
    <Animated.View
      style={{
        opacity: t,
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
        ],
        shadowColor: "#0b2545",
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }}
      className="w-full max-w-lg"
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityHint="Dismisses this message"
        testID={`toast-${toast.kind}`}
        onPress={onDismiss}
        className="flex-row items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
      >
        <Icon size={18} color={color} />
        <Text className="flex-1 text-sm text-foreground">{toast.message}</Text>
      </Pressable>
    </Animated.View>
  );
}
