type JupyterLabWorkVolumeEnv = {
  readonly [key: string]: string | undefined;
};

export function resolveJupyterLabWorkVolume(input: {
  env: JupyterLabWorkVolumeEnv;
  workdir: string;
}) {
  const pvcName = input.env.COLA_JUPYTERLAB_PVC_NAME?.trim();

  if (pvcName) {
    return {
      volume: {
        name: "jupyterlab-workdir",
        persistentVolumeClaim: {
          claimName: pvcName,
        },
      },
      mountPath:
        input.env.COLA_JUPYTERLAB_PVC_MOUNT_PATH?.trim() ?? input.workdir,
    };
  }

  return {
    volume: {
      name: "jupyterlab-workdir",
      emptyDir: {},
    },
    mountPath: input.workdir,
  };
}
