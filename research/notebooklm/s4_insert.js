const DOC = [
  '## 文档甲：ZX 系列设备技术说明',
  '',
  '§P01 本说明适用于 ZX 系列工业计量设备。ZX-9 型设备的额定功率为 47.3 千瓦，这是本机组的核心参数，验收时必须核对铭牌。',
  '§P02 ZX-9 使用 COOL-77 型冷却液，不得与 COOL-31 混用；混用会在三周内导致换热器结垢。',
  '§P03 ZX-9 的定期维护周期为每 640 运行小时一次，维护内容包括滤芯更换与轴承润滑。',
  '§P04 故障码 E-3112 表示泵压异常，处理顺序为先停机、再泄压、最后检查进口滤网。',
  '§P05 ZX-9 整机共安装 18 个传感器，其中压力传感器 6 个、温度传感器 7 个、流量传感器 5 个。',
  '§P06 当前配套固件版本为 v4.2.9，回退到 v4.1.x 会丢失自动校准功能。',
  '§P07 安全泄压阀的整定阈值为 0.86 MPa，超过该阈值 30 秒即触发联锁停机。',
  '',
  '### 备件与校准',
  '',
  '§P08 常备备件共 3 项：密封圈 KIT-12、滤芯 FLT-40、压力传感器 SEN-06。',
  '§P09 校准规程共 5 步：零点归位、量程标定、回程误差检查、温度补偿、签发校准记录。',
  '§P10 所有校准记录必须保留 5 年，并在设备档案中与序列号绑定。这条要求来自计量法实施细则。',
  '§P11 设备运行时人员须保持 12 米安全距离，检修时须挂牌上锁。',
  '§P12 所有校准记录必须保留 5 年，并在设备档案中与序列号绑定。这条要求来自计量法实施细则。',
  '',
  '## 文档甲：附注',
  '',
  '本文件由测试夹具生成，用于验证来源引用与定位行为，不含真实设备信息。',
].join('\n');

const dialog = q('[role=dialog]') || document;
const titleEl = dialog.querySelector('input.title-input') || q('input.title-input');
const bodyEl = dialog.querySelector('textarea.copied-text-input-textarea') ||
  qa('textarea').filter(vis).find(e => lab(e) === '粘贴的文字');

if (!bodyEl) return { error: 'paste textarea not found', buttons: buttons() };

if (titleEl) setValue(titleEl, 'KB探针-文档甲');
setValue(bodyEl, DOC);
await sleep(400);

const beforeLen = bodyEl.value.length;
const r = clickLabel('插入');
await sleep(6000);

return {
  click: r,
  docChars: DOC.length,
  docBytes: new TextEncoder().encode(DOC).length,
  valueLen: beforeLen,
  dialogStillOpen: Boolean(q('[role=dialog]')),
  text: text().slice(0, 1500),
};
