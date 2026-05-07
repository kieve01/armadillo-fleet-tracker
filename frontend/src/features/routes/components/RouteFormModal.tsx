import { Alert, Form, Input, Modal, Select } from 'antd'
import { useRoutesStore } from '../routesStore'
import type { RouteTravelMode } from '../types'

interface RouteFormModalProps {
  open: boolean
  onCancel: () => void
}

const TRAVEL_MODE_OPTIONS = [
  { value: 'Car', label: 'Auto' },
  { value: 'Truck', label: 'Camión' },
  { value: 'Walking', label: 'A pie' },
] as const

export default function RouteFormModal({ open, onCancel }: RouteFormModalProps) {
  const [form] = Form.useForm()
  const saveDraft = useRoutesStore((state) => state.saveDraft)
  const loading = useRoutesStore((state) => state.loading)
  const error = useRoutesStore((state) => state.error)

  const handleOk = async () => {
    const values = await form.validateFields()
    await saveDraft(values.routeId, values.travelMode as RouteTravelMode)

    if (!useRoutesStore.getState().error) {
      form.resetFields()
    }
  }

  return (
    <Modal
      title="Guardar ruta"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Guardar"
      cancelText="Cancelar"
      confirmLoading={loading}
      destroyOnClose
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} showIcon />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          travelMode: 'Car',
        }}
      >
        <Form.Item
          name="routeId"
          label="Nombre / ID"
          rules={[
            { required: true, message: 'Ingresa un nombre para la ruta' },
            {
              pattern: /^[a-zA-Z0-9_-]+$/,
              message: 'Solo letras, números, guiones y guiones bajos',
            },
          ]}
        >
          <Input placeholder="ej. ruta-centro-norte" autoFocus />
        </Form.Item>

        <Form.Item
          name="travelMode"
          label="Modo de viaje"
          rules={[{ required: true, message: 'Selecciona un modo de viaje' }]}
        >
          <Select options={TRAVEL_MODE_OPTIONS.map((option) => ({ ...option }))} />
        </Form.Item>
      </Form>
    </Modal>
  )
}