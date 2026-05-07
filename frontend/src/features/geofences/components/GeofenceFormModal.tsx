import { useEffect } from 'react'
import { Form, Input, Modal, Alert } from 'antd'
import { useGeofencesStore } from '../geofencesStore'

interface Props {
  open: boolean
  initialId?: string
  onCancel: () => void
}

export default function GeofenceFormModal({ open, initialId, onCancel }: Props) {
  const [form] = Form.useForm()
  const confirmSave = useGeofencesStore((s) => s.confirmSave)
  const loading = useGeofencesStore((s) => s.loading)
  const error = useGeofencesStore((s) => s.error)

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ geofenceId: initialId ?? '' })
    }
  }, [open, initialId, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    await confirmSave(values.geofenceId)
    if (!useGeofencesStore.getState().error) {
      form.resetFields()
    }
  }

  return (
    <Modal
      title="Guardar geocerca"
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
          name="geofenceId"
          label="Nombre / ID"
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
