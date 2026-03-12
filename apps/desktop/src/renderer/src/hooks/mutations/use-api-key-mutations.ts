import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import { createSecretKeyRecord, mapSecretStoreErrorToError, type SecretKey } from "@shared/secrets";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";

const createConfiguredMap = (value: boolean): Record<SecretKey, boolean> =>
  createSecretKeyRecord(() => value);

const createErrorMap = (value: string | null): Record<SecretKey, string | null> =>
  createSecretKeyRecord(() => value);

const createSavingMap = (value: boolean): Record<SecretKey, boolean> =>
  createSecretKeyRecord(() => value);

const setKey = <T>(
  record: Record<SecretKey, T>,
  key: SecretKey,
  value: T,
): Record<SecretKey, T> => ({
  ...record,
  [key]: value,
});

export type UseApiKeyMutationsResult = {
  readonly saving: Record<SecretKey, boolean>;
  readonly errors: Record<SecretKey, string | null>;
  readonly saveKey: (key: SecretKey, value: string) => void;
  readonly removeKey: (key: SecretKey) => void;
  readonly clearErrors: () => void;
};

export function useApiKeyMutations(): UseApiKeyMutationsResult {
  const ipc = useIpc();
  const queryClient = useQueryClient();

  const [errors, setErrors] = useState<Record<SecretKey, string | null>>(() =>
    createErrorMap(null),
  );
  const [saving, setSaving] = useState<Record<SecretKey, boolean>>(() => createSavingMap(false));

  const { mutate: saveKeyMutate } = useMutation({
    mutationFn: async ({ key, value }: { key: SecretKey; value: string }) => {
      await runIpcEffect(
        ipc.client.SetApiKey({ key, value }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSecretStoreErrorToError),
        ),
      );
      return runIpcEffect(
        ipc.client.HasApiKey({ key }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSecretStoreErrorToError),
        ),
      );
    },
    onMutate: ({ key }) => {
      setSaving((current) => setKey(current, key, true));
      setErrors((current) => setKey(current, key, null));
    },
    onSuccess: (result, { key }) => {
      queryClient.setQueryData<Record<SecretKey, boolean>>(
        queryKeys.apiKeysConfigured,
        (current = createConfiguredMap(false)) => setKey(current, key, result.configured),
      );
    },
    onError: (error, { key }) => {
      console.error(`[settings] save API key (${key})`, error);
      setErrors((current) => setKey(current, key, `Failed to save key: ${error.message}`));
    },
    onSettled: (_result, _error, { key }) => {
      setSaving((current) => setKey(current, key, false));
    },
  });

  const { mutate: removeKeyMutate } = useMutation({
    mutationFn: async ({ key }: { key: SecretKey }) => {
      await runIpcEffect(
        ipc.client.DeleteApiKey({ key }).pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSecretStoreErrorToError),
        ),
      );
      return { key };
    },
    onMutate: ({ key }) => {
      setSaving((current) => setKey(current, key, true));
      setErrors((current) => setKey(current, key, null));
    },
    onSuccess: ({ key }) => {
      queryClient.setQueryData<Record<SecretKey, boolean>>(
        queryKeys.apiKeysConfigured,
        (current = createConfiguredMap(false)) => setKey(current, key, false),
      );
    },
    onError: (error, { key }) => {
      console.error(`[settings] remove API key (${key})`, error);
      setErrors((current) => setKey(current, key, `Failed to remove key: ${error.message}`));
    },
    onSettled: (_result, _error, { key }) => {
      setSaving((current) => setKey(current, key, false));
    },
  });

  const saveKey = useCallback(
    (key: SecretKey, value: string) => {
      saveKeyMutate({ key, value });
    },
    [saveKeyMutate],
  );

  const removeKey = useCallback(
    (key: SecretKey) => {
      removeKeyMutate({ key });
    },
    [removeKeyMutate],
  );

  const clearErrors = useCallback(() => {
    setErrors(createErrorMap(null));
  }, []);

  return {
    saving,
    errors,
    saveKey,
    removeKey,
    clearErrors,
  };
}
