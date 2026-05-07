import { Form, Input, Modal } from 'antd'
import { useVehiclesStore } from '../vehiclesStore'

interface Props {
  open: boolean
  onClose: () => void
}

export default function CreateTrackerModal({ open, onClose }: Props) {
  const [form] = Form.useForm()
  const createTracker = useVehiclesStore((s) => s.createTracker)
  const loading = useVehiclesStore((s) => s.loading)

  const handleOk = async () => {
    const { trackerName, description } = await form.validateFields()
    await createTracker(trackerName, description || undefined)
    if (!useVehiclesStore.getState().error) {
      form.resetFields()
      onClose()
    }
  }

  return (
    <Modal
      title="Nuevo tracker"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="Crear"
      cancelText="Cancelar"
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="trackerName"
          label="Nombre del tracker"
          rules={[
            { required: true, message: 'Ingresa un nombre' },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: 'Solo letras, números, guiones y guiones bajos' },
          ]}
        >
          <Input placeholder="ej. flota-lima" autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Descripción (opcional)">
          <Input placeholder="ej. Flota Lima Norte" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
