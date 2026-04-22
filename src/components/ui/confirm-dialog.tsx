"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmDialogOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: React.ComponentProps<typeof AlertDialogAction>["variant"];
};

type ConfirmDialogState = ConfirmDialogOptions & {
  open: boolean;
};

const initialState: ConfirmDialogState = {
  open: false,
  title: "",
  description: undefined,
  confirmLabel: "确定",
  cancelLabel: "取消",
  confirmVariant: "destructive",
};

export function useConfirmDialog() {
  const resolveRef = React.useRef<((value: boolean) => void) | null>(null);
  const [state, setState] = React.useState<ConfirmDialogState>(initialState);

  const settle = React.useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(value);
  }, []);

  const close = React.useCallback(
    (value: boolean) => {
      setState((current) => ({ ...current, open: false }));
      settle(value);
    },
    [settle],
  );

  const confirm = React.useCallback((options: ConfirmDialogOptions) => {
    resolveRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? "确定",
        cancelLabel: options.cancelLabel ?? "取消",
        confirmVariant: options.confirmVariant ?? "destructive",
      });
    });
  }, []);

  const dialog = (
    <AlertDialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) {
          close(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description ? (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {state.cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={state.confirmVariant}
            onClick={() => close(true)}
          >
            {state.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  React.useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  return { confirm, confirmDialog: dialog };
}
