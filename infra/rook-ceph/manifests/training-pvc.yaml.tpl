apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${ROOK_TRAINING_PVC_NAME}
  namespace: ${ROOK_TRAINING_NAMESPACE}
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: ${ROOK_CEPHFS_STORAGECLASS}
  resources:
    requests:
      storage: ${ROOK_TRAINING_PVC_SIZE}
