apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${JUICEFS_STORAGECLASS_NAME}
  # Add this annotation only when JUICEFS_SET_DEFAULT_STORAGECLASS=1:
  # annotations:
  #   storageclass.kubernetes.io/is-default-class: "true"
provisioner: csi.juicefs.com
reclaimPolicy: ${JUICEFS_RECLAIM_POLICY}
allowVolumeExpansion: ${JUICEFS_ALLOW_VOLUME_EXPANSION}
parameters:
  csi.storage.k8s.io/provisioner-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/provisioner-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
  csi.storage.k8s.io/node-publish-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/node-publish-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
  csi.storage.k8s.io/controller-expand-secret-name: ${JUICEFS_SECRET_NAME}
  csi.storage.k8s.io/controller-expand-secret-namespace: ${JUICEFS_SECRET_NAMESPACE}
# mountOptions:
#   - cache-size=10240
