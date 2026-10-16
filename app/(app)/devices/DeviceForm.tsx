import { Button, Field, Input, Select } from '@/components/ui'

export interface DeviceValues { id?: string; name?: string; type?: string; ip?: string | null; port?: number | string; serial?: string | null; publicHost?: string | null; publicPort?: number | string | null }

export function DeviceForm({ action, v, submit }: { action: (f: FormData) => Promise<void>; v: DeviceValues; submit: string }) {
  return (
    <form action={action} className="max-w-[720px] space-y-6">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name"><Input name="name" defaultValue={v.name ?? ''} placeholder="e.g. Front gate" required /></Field>
        <Field label="How it reaches us">
          <Select name="type" defaultValue={v.type ?? 'pull'}>
            <option value="pull">Pulled: this system reads it over the network</option>
            <option value="adms">Pushed: the device sends scans to this system</option>
          </Select>
        </Field>
        <Field label="Public host" hint="The router address that forwards to the device. This is what the sync dials."><Input name="publicHost" defaultValue={v.publicHost ?? ''} autoComplete="off" /></Field>
        <Field label="Public port" hint="Empty means 4370."><Input name="publicPort" type="number" defaultValue={v.publicPort ?? ''} min={1} max={65535} /></Field>
        <Field label="LAN IP address" hint="Informational. The device's address inside the factory."><Input name="ip" defaultValue={v.ip ?? ''} autoComplete="off" /></Field>
        <Field label="LAN port"><Input name="port" type="number" defaultValue={v.port ?? 4370} min={1} max={65535} /></Field>
        <Field label="Serial number" hint="Optional. Used to match pushed scans."><Input name="serial" defaultValue={v.serial ?? ''} autoComplete="off" /></Field>
      </div>
      <Button type="submit" variant="primary">{submit}</Button>
    </form>
  )
}
