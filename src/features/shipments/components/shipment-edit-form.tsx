'use client';

// P3-S2B: 在途基本信息编辑表单
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { updateShipment } from '@/features/shipments/actions';
import { Loader2Icon, PencilIcon, XIcon } from 'lucide-react';
import type { ShipmentDetail, WarehouseSelectorItem } from '@/features/shipments/types';

const COUNTRIES = [
  { value: 'TH', label: '泰国 (TH)' },
  { value: 'ID', label: '印尼 (ID)' },
  { value: 'MY', label: '马来西亚 (MY)' },
  { value: 'PH', label: '菲律宾 (PH)' },
  { value: 'VN', label: '越南 (VN)' },
  { value: 'CN', label: '中国 (CN)' },
] as const;

interface Props {
  shipment: ShipmentDetail;
  warehouses: WarehouseSelectorItem[];
  isAdmin: boolean;
}

export function ShipmentEditForm({ shipment, warehouses, isAdmin }: Props) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [shipmentNo, setShipmentNo] = useState(shipment.shipment_no ?? '');
  const [purchaseOrderNo, setPurchaseOrderNo] = useState(shipment.purchase_order_no ?? '');
  const [vesselName, setVesselName] = useState(shipment.vessel_name ?? '');
  const [voyageNumber, setVoyageNumber] = useState(shipment.voyage_number ?? '');
  const [originPort, setOriginPort] = useState(shipment.origin_port ?? '');
  const [destinationPort, setDestinationPort] = useState(shipment.destination_port ?? '');
  const [country, setCountry] = useState(shipment.country ?? '');
  const [warehouseId, setWarehouseId] = useState(shipment.warehouse_id ?? '');
  const [estimatedArrival, setEstimatedArrival] = useState(shipment.estimated_arrival ?? '');
  const [note, setNote] = useState(shipment.note ?? '');

  const handleCancel = () => {
    setShipmentNo(shipment.shipment_no ?? '');
    setPurchaseOrderNo(shipment.purchase_order_no ?? '');
    setVesselName(shipment.vessel_name ?? '');
    setVoyageNumber(shipment.voyage_number ?? '');
    setOriginPort(shipment.origin_port ?? '');
    setDestinationPort(shipment.destination_port ?? '');
    setCountry(shipment.country ?? '');
    setWarehouseId(shipment.warehouse_id ?? '');
    setEstimatedArrival(shipment.estimated_arrival ?? '');
    setNote(shipment.note ?? '');
    setEditing(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipmentNo.trim() || !country) return;
    setSubmitting(true);

    try {
      const result = await updateShipment({
        id: shipment.id,
        shipmentNo: shipmentNo.trim(),
        purchaseOrderNo: purchaseOrderNo.trim() || undefined,
        vesselName: vesselName.trim() || undefined,
        voyageNumber: voyageNumber.trim() || undefined,
        originPort: originPort.trim() || undefined,
        destinationPort: destinationPort.trim() || undefined,
        country,
        warehouseId: warehouseId || undefined,
        estimatedArrival: estimatedArrival || undefined,
        note: note.trim() || undefined,
      });

      if (!result.success) {
        toast.error(result.error ?? '更新失败');
        return;
      }
      toast.success('在途信息已更新');
      setEditing(false);
    } catch {
      toast.error('更新失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          aria-label="编辑基本信息"
        >
          <PencilIcon className="size-3.5 mr-1" />
          编辑基本信息
        </Button>
      </div>
    );
  }

  const filteredWarehouses = country
    ? warehouses.filter((w) => w.country === country)
    : warehouses;

  return (
    <form onSubmit={handleSubmit} className="border rounded-md p-4 space-y-3 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">编辑基本信息</h3>
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={handleCancel} aria-label="取消编辑">
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-shipmentNo" className="text-xs">
            单号 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="edit-shipmentNo"
            value={shipmentNo}
            onChange={(e) => setShipmentNo(e.target.value)}
            maxLength={50}
            className="h-8 text-sm"
            aria-label="单号"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-purchaseOrderNo" className="text-xs">采购单号</Label>
          <Input
            id="edit-purchaseOrderNo"
            value={purchaseOrderNo}
            onChange={(e) => setPurchaseOrderNo(e.target.value)}
            maxLength={100}
            className="h-8 text-sm"
            aria-label="采购单号"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-country" className="text-xs">
            目的国 <span className="text-destructive">*</span>
          </Label>
          <Select value={country} onValueChange={(v) => { setCountry(v ?? ''); setWarehouseId(''); }}>
            <SelectTrigger id="edit-country" className="h-8 text-sm" aria-label="选择目的国">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-vesselName" className="text-xs">船名</Label>
          <Input id="edit-vesselName" value={vesselName} onChange={(e) => setVesselName(e.target.value)} maxLength={200} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-voyageNumber" className="text-xs">航次</Label>
          <Input id="edit-voyageNumber" value={voyageNumber} onChange={(e) => setVoyageNumber(e.target.value)} maxLength={100} className="h-8 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-originPort" className="text-xs">起运港</Label>
          <Input id="edit-originPort" value={originPort} onChange={(e) => setOriginPort(e.target.value)} maxLength={100} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-destinationPort" className="text-xs">目的港</Label>
          <Input id="edit-destinationPort" value={destinationPort} onChange={(e) => setDestinationPort(e.target.value)} maxLength={100} className="h-8 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-warehouseId" className="text-xs">仓库</Label>
          <Select
            value={warehouseId || '__none__'}
            onValueChange={(v) => setWarehouseId((v ?? '') === '__none__' ? '' : (v ?? ''))}
            disabled={!country}
          >
            <SelectTrigger id="edit-warehouseId" className="h-8 text-sm" aria-label="选择仓库">
              <SelectValue placeholder="选择仓库" />
            </SelectTrigger>
            <SelectContent>
              {isAdmin && <SelectItem value="__none__">不指定仓库</SelectItem>}
              {filteredWarehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-estimatedArrival" className="text-xs">预计到仓日期</Label>
          <Input id="edit-estimatedArrival" type="date" value={estimatedArrival} onChange={(e) => setEstimatedArrival(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-note" className="text-xs">备注</Label>
        <Textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="text-sm" />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={submitting || !shipmentNo.trim() || !country} size="sm" aria-label="保存编辑">
          {submitting ? <><Loader2Icon className="size-3.5 animate-spin mr-1" />保存中...</> : '保存'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleCancel} aria-label="取消编辑">取消</Button>
      </div>
    </form>
  );
}
