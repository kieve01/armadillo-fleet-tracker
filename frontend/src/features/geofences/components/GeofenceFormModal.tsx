import { useEffect } from 'react'
import { Form, Input, Modal, Alert } from 'antd'
import { useGeofencesStore, parseGeofenceId } from '../geofencesStore'

interface Props {
  open: boolean
  initialId?: string   // full geofenceId when editing (trackerName__name)
  onCancel: () => void
}

export default function GeofenceFormModal({ open, initialId, onCancel }: Props) {
  const [form] = Form.useForm()
  const confirmSave = useGeofencesStore(s => s.confirmSave)
  const loading     = useGeofencesStore(s => s.loading)
  const error       = useGeofencesStore(s => s.error)
  const draft       = useGeofencesStore(s => s.draft)

  useEffect(() => {
    if (open) {
      // When editing, prefill with just the name part (strip tracker prefix)
      const name = initialId ? parseGeofenceId(initialId).name : ''
      form.setFieldsValue({ name })
    }
  }, [open, initialId, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    await confirmSave(values.name)
    if (!useGeofencesStore.getState().error) form.resetFields()
  }

  const isEdit = !!initialId
  const trackerLabel = draft?.trackerName ? ` · ${draft.trackerName}` : ''

  return (
    <Modal
      title={isEdit ? 'Editar geocerca' : `Nueva geocerca${trackerLabel}`}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Guardar"
      cancelText="Cancelar"
      confirmLoading={loading}
      destroyOnClose
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="Nombre"
          rules={[
            { required: true, message: 'Ingresa un nombre' },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: 'Solo letras, números, guiones y guiones bajos' },
          ]}
        >
          <Input placeholder="ej. zona-norte-lima" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
