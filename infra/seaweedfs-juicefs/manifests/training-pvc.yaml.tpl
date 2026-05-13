apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${TRAINING_PVC_NAME}
  namespace: ${TRAINING_NAMESPACE}
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: ${JUICEFS_STORAGECLASS_NAME}
  resources:
    requests:
      storage: ${TRAINING_PVC_SIZE}
