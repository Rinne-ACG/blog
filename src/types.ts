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

// 生产良率记录
export interface ProductionRecord {
  id: string;          // 唯一标识
  date: string;        // 生产日期，格式：YYYY-MM-DD
  productModel: string; // 产品型号
  productionQty: number;  // 生产数量
  goodQty: number;     // 良品数量
  defectQty: number;   // 不良数量（自动计算：生产数量 - 良品数量）
  yieldRate: number;   // 良率（自动计算：良品数量 / 生产数量 * 100，保留2位小数）
  notes: string;        // 备注
}
