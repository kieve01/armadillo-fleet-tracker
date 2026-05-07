import { Form, Input, Modal, Select, Typography } from 'antd'
import { useVehiclesStore } from '../vehiclesStore'

interface Props {
  open: boolean
  onCancel: () => void
}

export default function PlaceDeviceModal({ open, onCancel }: Props) {
  const [form] = Form.useForm()
  const trackerResources = useVehiclesStore((s) => s.trackerResources)
  const confirmPlaceDevice = useVehiclesStore((s) => s.confirmPlaceDevice)
  const loading = useVehiclesStore((s) => s.loading)
  const pendingLocation = useVehiclesStore((s) => s.pendingLocation)

  const handleOk = async () => {
    const { trackerName, deviceId } = await form.validateFields()
    await confirmPlaceDevice(trackerName, deviceId)
    if (!useVehiclesStore.getState().error) form.resetFields()
  }

  return (
    <Modal
      title="Colocar vehículo"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Colocar"
      cancelText="Cancelar"
      confirmLoading={loading}
      destroyOnClose
    >
      {pendingLocation && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Ubicación: {pendingLocation.lat.toFixed(6)}, {pendingLocation.lng.toFixed(6)}
        </Typography.Text>
      )}
      <Form form={form} layout="vertical">
        <Form.Item
          name="trackerName"
          label="Tracker"
          rules={[{ required: true, message: 'Selecciona un tracker' }]}
        >
          <Select
            placeholder="Selecciona un tracker"
            options={trackerResources.map((r) => ({ value: r.trackerName, label: r.trackerName }))}
          />
        </Form.Item>
        <Form.Item
          name="deviceId"
          label="ID del vehículo"
          rules={[
            { required: true, message: 'Ingresa un ID' },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: 'Solo letras, números, guiones y guiones bajos' },
          ]}
        >
          <Input placeholder="ej. vehiculo-01" autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  )
}
