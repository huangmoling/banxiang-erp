-- P11 一单多地址：给「已生效的出库单」的行补上发货标记
--
-- 背景：P11 之前出库是整单审核，没有「哪一行什么时候发的」这个概念。
-- 加了 document_items.shippedAt 之后，老单据的行全是空，会被当成「还没发」——
-- 表现就是：已发完的历史单在明细里每行都写着「待发」，
-- 打印「还没发的」会把历史单全打出来，删行/改地址也拦不住。
--
-- 回填规则：出库单里 status='approved' 的单，它的每一行都算已发，
-- 时间取审核时间（没有就用业务日期），人取审核人。
-- 退货 / 入库 / 盘点 / 报废的行一律不动（WHERE 限定 type 与 status）。

UPDATE document_items
SET
  shippedAt = COALESCE(
    (SELECT d.approvedAt FROM documents d WHERE d.id = document_items.documentId),
    (SELECT d.bizDate    FROM documents d WHERE d.id = document_items.documentId)
  ),
  shippedById = (SELECT d.approvedById FROM documents d WHERE d.id = document_items.documentId)
WHERE shippedAt IS NULL
  AND documentId IN (
    SELECT id FROM documents WHERE type = 'outbound' AND status = 'approved'
  );
