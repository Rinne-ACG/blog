export interface Post {
  id: string;
  title: string;
  slug: string;
  date: string;
  summary: string;
  tags: string[];
  content: string;
  coverImage?: string;
  readingTime?: number;
}

export interface Tag {
  name: string;
  count: number;
}

// 不良分析记录
export interface DefectAnalysisRecord {
  id: string;
  entryDate: string;         // 日期
  seq: string;               // 序号
  workOrderNo: string;       // 流转单号
  specSize: string;          // 规格尺寸
  foilSupplier: string;      // 正箔供应商
  foilVoltage: string;       // 正箔电压
  foilBatchNo: string;       // 正箔批号
  faultJudgment: string;     // 异常责任判定
  // 异常详情
  chargeQty: number;         // 充电数量
  defectQty: number;         // 不良数
  goodRechargeDefect: number;  // 良品反充不良数
  defectRechargeDefect: number; // 不良品反充不良数
  // 分析
  defectCause: string;       // 不良原因分析
  notes: string;             // 备注
}

// 生产良率记录（牛角车间）
export interface ProductionRecord {
  id: string;

  // 基本信息
  entryDate: string;       // 录入日期
  cycle?: string;          // 周期（引线统计用）
  batchNo?: string;        // 批号（引线统计用）
  seq: string;             // 序号
  materialCode: string;    // 物料代码
  spec: string;            // 规格
  size: string;            // 尺寸
  workOrderNo: string;     // 流转单号

  // 电气参数
  positiveFoilVoltage: string; // 正箔电压

  // 数量统计
  designQty: number;       // 设计数量
  actualQty: number;       // 实际此单总数
  windingQty: number;      // 卷绕数
  goodQty: number;         // 良品数
  loss: number;            // 损耗

  // 良率统计（%，自动计算或手动填写）
  firstBottomConvexShortBurstRate: number; // 一次底凸短路爆破率
  firstPassRate: number;   // 一次直通率
  batchYieldRate?: number;  // 整批良率（手动填写，导入时无值则为空）

  // 不良分类（件数）
  defectShort: number;     // 短路
  defectBurst: number;     // 爆破
  defectBottomConvex: number; // 底凸
  defectVoltage: number;   // 耐压
  defectAppearance: number;   // 外观
  defectLeakage: number;   // 漏电
  defectHighCap: number;   // 高容
  defectLowCap: number;    // 低容
  defectDF: number;        // DF

  // 其他
  operator: string;        // 作业员
  notes: string;           // 备注
  reworkOrderNo: string;   // 重工单号

  // 批注（格式：{ "fieldName": "批注内容" }）
  comments?: Record<string, string>;
}
