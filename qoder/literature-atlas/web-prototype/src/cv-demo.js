import { paperToNode } from './literature-model.js';

// A curated, read-only example. Links describe the relationship shown in the
// source papers; thematic comparisons are labelled separately from extensions.
const papers = [
  { id: 'cv-alexnet', year: 2012, title: 'ImageNet Classification with Deep Convolutional Neural Networks', topKeyword: '深层卷积网络', authors: 'Alex Krizhevsky, Ilya Sutskever, Geoffrey E. Hinton', doi: 'https://papers.nips.cc/paper_files/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html', tags: ['图像分类', 'CNN'], abstract: 'AlexNet 以深层卷积网络完成大规模 ImageNet 图像分类，成为后续视觉网络设计的重要参照。' },
  { id: 'cv-vgg', year: 2015, title: 'Very Deep Convolutional Networks for Large-Scale Image Recognition', topKeyword: '小卷积核深层网络', authors: 'Karen Simonyan, Andrew Zisserman', doi: 'https://www.robots.ox.ac.uk/~vgg/publications/2015/Simonyan15/', tags: ['图像分类', 'CNN', '视觉骨干'], abstract: 'VGG 系统研究网络深度，用连续的小卷积核构建 16 到 19 层的图像分类网络。' },
  { id: 'cv-faster', year: 2015, title: 'Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks', topKeyword: '区域建议网络', authors: 'Shaoqing Ren, Kaiming He, Ross Girshick, Jian Sun', doi: 'https://papers.nips.cc/paper/2015/hash/14bfa6bb14875e45bba028a21ed38046-Abstract.html', tags: ['目标检测', 'CNN', '区域建议'], abstract: 'Faster R-CNN 引入区域建议网络，与检测网络共享卷积特征，减少候选区域生成的开销。' },
  { id: 'cv-unet', year: 2015, title: 'U-Net: Convolutional Networks for Biomedical Image Segmentation', topKeyword: '收缩—扩张路径', authors: 'Olaf Ronneberger, Philipp Fischer, Thomas Brox', doi: 'https://arxiv.org/abs/1505.04597', tags: ['图像分割', 'CNN', '医学影像'], abstract: 'U-Net 采用收缩路径与对称的扩张路径，使网络在有限标注的医学影像上完成像素级分割。' },
  { id: 'cv-resnet', year: 2016, title: 'Deep Residual Learning for Image Recognition', topKeyword: '残差学习', authors: 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun', doi: 'https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html', tags: ['图像分类', 'CNN', '视觉骨干'], abstract: 'ResNet 用残差连接缓解深层网络的优化困难，使更深的视觉网络可以有效训练。' },
  { id: 'cv-mask', year: 2017, title: 'Mask R-CNN', topKeyword: '实例分割', authors: 'Kaiming He, Georgia Gkioxari, Piotr Dollár, Ross Girshick', doi: 'https://openaccess.thecvf.com/content_iccv_2017/html/He_Mask_R-CNN_ICCV_2017_paper.html', tags: ['目标检测', '实例分割', '图像分割'], abstract: 'Mask R-CNN 在 Faster R-CNN 上增加并行的掩码预测分支，让检测框与实例级分割同时完成。' },
  { id: 'cv-vit', year: 2021, title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', topKeyword: '图像 Patch', authors: 'Alexey Dosovitskiy et al.', doi: 'https://openreview.net/forum?id=YicbFdNTTy', tags: ['图像分类', 'Transformer', '视觉骨干'], abstract: 'ViT 将图像划分为 patch 序列，直接用 Transformer 处理图像分类，展示了大规模预训练后的视觉表现。' },
  { id: 'cv-clip', year: 2021, title: 'Learning Transferable Visual Models From Natural Language Supervision', topKeyword: '自然语言监督', authors: 'Alec Radford et al.', doi: 'https://proceedings.mlr.press/v139/radford21a.html', tags: ['视觉语言', '零样本', '图像分类'], abstract: 'CLIP 利用图像与文本配对进行训练，使自然语言可以描述视觉类别并支持零样本迁移。' },
  { id: 'cv-sam', year: 2023, title: 'Segment Anything', topKeyword: '可提示分割', authors: 'Alexander Kirillov et al.', doi: 'https://openaccess.thecvf.com/content/ICCV2023/html/Kirillov_Segment_Anything_ICCV_2023_paper.html', tags: ['图像分割', '提示式交互', '视觉基础模型'], abstract: 'SAM 提出可提示的分割模型与大规模掩码数据集，面向新图像分布和任务进行零样本迁移。' },
];

const edges = [
  ['cv-alexnet', 'cv-vgg', 'progress', '分类主线：VGG 继续研究更深的卷积网络。'],
  ['cv-vgg', 'cv-resnet', 'progress', '分类主线：ResNet 针对深层网络优化困难引入残差学习，并与 VGG 作比较。'],
  ['cv-vgg', 'cv-faster', 'branch', '检测分支：Faster R-CNN 论文使用 VGG-16 作为卷积特征骨干。'],
  ['cv-faster', 'cv-mask', 'progress', '明确扩展：Mask R-CNN 在 Faster R-CNN 上增加实例掩码分支。'],
  ['cv-unet', 'cv-mask', 'branch', '主题对照：两者都处理像素级分割，但任务与结构不同。'],
  ['cv-resnet', 'cv-vit', 'branch', '架构对照：从卷积骨干转向 Transformer 图像表示；不表示 ViT 直接继承 ResNet。'],
  ['cv-vit', 'cv-sam', 'branch', '架构关联：SAM 图像编码器采用 ViT。'],
  ['cv-clip', 'cv-sam', 'branch', '主题对照：都探索跨任务迁移；CLIP 侧重语言监督，SAM 侧重可提示分割。'],
];

// One representative turning point per major step in this example's
// classification/segmentation/architecture story; other papers remain ordinary nodes.
const milestoneIds = new Set(['cv-alexnet', 'cv-unet', 'cv-resnet', 'cv-vit']);

export function createCvDemoGraph() {
  return {
    nodes: papers.map((paper, index) => {
      const node = paperToNode({ ...paper, type: milestoneIds.has(paper.id) ? 'milestone' : 'memory' }, index);
      node.x = (index % 2 ? 1 : -1) * (1.4 + (index % 3) * .17);
      if (paper.id === 'cv-unet') node.x = 2.15;
      node.z = ((index % 4) - 1.5) * .24;
      return node;
    }),
    links: edges.map(([from, to, kind, reason], index) => ({ id: `cv-link-${index}`, from, to, kind, reason })),
    mode: 'preview', scale: 'year', autoRotate: true, angle: .52, focusShift: 0,
  };
}
