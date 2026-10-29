export const NODE_TYPES = [
  { id: 'memory', name: '普通记忆', shape: '<circle r="3.1" fill="currentColor" stroke="none"/>' },
  { id: 'goal', name: '目标', shape: '<circle r="8.5"/><circle r="5"/><circle r="1.5"/><path d="M9.5-9.5 0 0M0-3.2V0h3.2" stroke="#090a0b" stroke-width="3.8"/><path d="M9.5-9.5 0 0M0-3.2V0h3.2"/>' },
  { id: 'milestone', name: '里程碑', shape: '<path d="M0-9.5 2.7-2.7 9.5 0 2.7 2.7 0 9.5-2.7 2.7-9.5 0-2.7-2.7Z"/>' },
  { id: 'start', name: '起点', shape: '<path d="M-6 9.5V-9M-6-8 8-2-6 3"/>' },
  { id: 'end', name: '终点', shape: '<path d="M-6 9.5V-9"/><path d="M-6-7.5c4-4 9 3.5 14-.5V2c-5 4-10-3.5-14 .5"/>' },
];
export const nodeType = (type) => NODE_TYPES.find((item) => item.id === type) || NODE_TYPES[0];
export const nodeTypeIcon = (type) => `<svg class="node-type-icon" viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${nodeType(type).shape}</svg>`;
export const nodeTypePicker = () => `<fieldset class="node-type-picker"><legend>节点类型</legend><div class="node-type-options">${NODE_TYPES.map((type, index) => `<label class="node-type-option"><input type="radio" name="type" value="${type.id}" ${index === 0 ? 'checked' : ''}/><span class="node-type-card">${nodeTypeIcon(type.id)}<span><strong>${type.name}</strong></span><i aria-hidden="true">✓</i></span></label>`).join('')}</div></fieldset>`;
