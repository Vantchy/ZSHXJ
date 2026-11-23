/** Small CLA equation board: 3 handwritten expansions, server verified on save. */
export function mountYinCarryBoard({host, onSolved, onClose, readonly=false}){
  const panel=document.createElement('section');panel.className='mj-story-modal mj-board-modal';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label','进位展开');host.append(panel);
  const shade=document.createElement('div');shade.className='mj-story-shade';panel.append(shade);
  const shell=document.createElement('div');shell.className='mj-story-shell';panel.append(shell);
  function el(tag,text,parent,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;}
  el('h2','亲写进位展开式',shell);
  el('p','约定 Gᵢ=AᵢBᵢ，Pᵢ=Aᵢ⊕Bᵢ；C₁=G0+P0·C0。请将 C₂、C₃、C₄ 全部展开至 G、P、C0。',shell);
  el('p','用 + 表示或、· 或 * 表示与；可用括号。',shell,'mj-story-hint');
  const inputs={};const labels={C2:'第二级 C₂',C3:'第三级 C₃',C4:'第四级 C₄'};
  const form=el('form',null,shell,'yin-carry-form');
  for(const name of Object.keys(labels)){
    const label=el('label',labels[name],form);label.style.display='block';label.style.margin='12px 0';
    const field=el('input',null,label);field.type='text';field.maxLength=240;field.required=true;
    field.autocomplete='off';field.placeholder='例如 G1 + P1·G0 + P1·P0·C0';
    field.style.width='100%';field.style.fontSize='16px';field.style.padding='8px';inputs[name]=field;
  }
  const message=el('p','',shell,'mj-story-status');message.setAttribute('role','status');
  const buttons=el('div',null,shell,'mj-story-footer');
  function close(){panel.remove();onClose?.();}
  const cancel=el('button',readonly?'结束回顾':'关闭',buttons,'mj-story-quiet');cancel.type='button';cancel.addEventListener('click',close);
  const confirm=el('button',readonly?'核对式子':'提交展开式',buttons,'mj-story-primary');confirm.type='button';
  let busy=false;
  confirm.addEventListener('click',async()=>{
    if(busy)return;
    const answers=Object.fromEntries(Object.keys(inputs).map(name=>[name,inputs[name].value.trim()]));
    if(Object.values(answers).some(v=>!v)){message.textContent='请补全三个式子。';return;}
    // The server will validate the actual expressions in the saved step evidence.
    busy=true;confirm.disabled=true;message.textContent='正在核对并保存…';
    try {await onSolved?.(answers);panel.remove();}
    catch(error){busy=false;confirm.disabled=false;message.textContent=error?.message||'保存失败，请检查式子。';}
  });
  form.addEventListener('submit',event=>{event.preventDefault();confirm.click();});
  shade.addEventListener('click',close);
  return {close};
}
