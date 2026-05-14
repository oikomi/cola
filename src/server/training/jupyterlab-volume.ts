import { resolveKubernetesWorkVolume } from "./work-volume.ts";

type JupyterLabWorkVolumeEnv = Readonly<Record<string, string | undefined>>;

export function resolveJupyterLabWorkVolume(input: {
  env: JupyterLabWorkVolumeEnv;
  workdir: string;
}) {
  return resolveKubernetesWorkVolume({
    env: input.env,
    volumeName: "jupyterlab-workdir",
    defaultMountPath: input.workdir,
    seaweedfsEnabledEnvNames: ["COLA_JUPYTERLAB_SEAWEEDFS_MOUNT_ENABLED"],
    mountPathEnvNames: [
      "COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    hostPathEnvNames: [
      "COLA_JUPYTERLAB_WORKDIR_HOST_PATH",
      "COLA_TRAINING_WORKDIR_HOST_PATH",
    ],
    hostPathMountPathEnvNames: [
      "COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH",
      "COLA_TRAINING_WORKDIR_MOUNT_PATH",
    ],
    pvcNameEnvNames: ["COLA_JUPYTERLAB_PVC_NAME"],
    pvcMountPathEnvNames: ["COLA_JUPYTERLAB_PVC_MOUNT_PATH"],
  });
}
