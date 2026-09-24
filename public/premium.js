(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (url,opt={}) => { opt.headers={...(opt.headers||{}),...(localStorage.getItem('vm_token')?{Authorization:'Bearer '+localStorage.getItem('vm_token')}:{})}; if(opt.body&&typeof opt.body!=='string'){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(opt.body)} const r=await fetch(url,opt),d=await r.json().catch(()=>({})); if(!r.ok)throw Error(d.error||'Request failed'); return d; };
  const getUser = () => { try{return JSON.parse(localStorage.getItem('vm_user')||'null')}catch{return null} };
  const getDiscover = async () => api('/api/discover');
  const toast = x => alert(x);

  if (!document.getElementById('premiumFeatureStyles')) {
    const st = document.createElement('style');
    st.id = 'premiumFeatureStyles';
    st.textContent = `
      .vmPowerupBar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
      .vmPowerupBtn{border:1px solid #ebe7f6;background:#fff;border-radius:14px;padding:10px 14px;font-weight:850;cursor:pointer;box-shadow:0 8px 24px rgba(60,45,100,.06)}
      .vmPowerupBtn:hover{transform:translateY(-1px)}
      .vmPowerupBtn.star{background:linear-gradient(135deg,#fff8d9,#fff);border-color:#f2d56b}
      .vmPowerupBtn.boost{background:linear-gradient(135deg,#efe9ff,#fff);border-color:#c9b8ff}
      .vmPowerupBtn.rewind{background:linear-gradient(135deg,#eaf6ff,#fff);border-color:#b7dfff}
      .vmPremiumPanel{margin:0 0 18px;padding:18px;border:1px solid #ebe7f6;border-radius:22px;background:linear-gradient(135deg,#fff,#faf7ff);box-shadow:0 12px 35px rgba(60,45,100,.06)}
      .vmPremiumPanelHead{display:flex;justify-content:space-between;align-items:center;gap:12px}
      .vmPremiumGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:13px}
      .vmPremiumTile{padding:13px;border:1px solid #eeeaf5;border-radius:16px;background:#fff}
      .vmPremiumTile b{display:block;margin-bottom:4px}
      .vmPremiumTile small{color:#777;font-size:11px;line-height:1.4}
      .vmSuperBadge{position:absolute;left:12px;top:12px;padding:7px 10px;border-radius:999px;background:linear-gradient(135deg,#ffd84d,#ff9f1c);color:#5b3b00;font-size:10px;font-weight:950;box-shadow:0 8px 20px rgba(255,169,35,.25)}
      .vmActionRow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .vmActionRow button{min-height:40px}
      .vmLikesHero{padding:18px;border-radius:22px;background:linear-gradient(135deg,#fff4fa,#f5f0ff);border:1px solid #eee5f7;margin-bottom:16px}
      .vmLikesStats{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px}
      .vmLikesStat b{font-size:20px;display:block}.vmLikesStat span{font-size:11px;color:#777}
      @media(max-width:700px){.vmPremiumGrid{grid-template-columns:1fr}.vmPremiumPanelHead{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(st);
  }

  async function loadRazorpay(){
    if(window.Razorpay)return;
    await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://checkout.razorpay.com/v1/checkout.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  }

  async function payFeature(product, description, afterVerify){
    const order=await api('/api/features/order',{method:'POST',body:{product}});
    await loadRazorpay();
    return new Promise((resolve,reject)=>{
      const checkout=new Razorpay({
        key:order.keyId,amount:order.amount,currency:'INR',name:'VibeMeet',description,order_id:order.orderId,
        prefill:{name:getUser()?.name||'',email:getUser()?.email||''},theme:{color:'#6b4ce6'},
        modal:{ondismiss:()=>reject(new Error('Payment cancelled'))},
        handler:async payment=>{
          try{
            await api('/api/features/verify',{method:'POST',body:{orderId:payment.razorpay_order_id,paymentId:payment.razorpay_payment_id,signature:payment.razorpay_signature}});
            if(afterVerify)await afterVerify();
            resolve();
          }catch(e){reject(e)}
        }
      });
      checkout.open();
    });
  }

  async function sendSuperLikeTarget(targetId,name='this profile'){
    try{
      const result=await api('/api/super-likes/use',{method:'POST',body:{targetId}}).catch(async e=>{
        if(!String(e.message||'').includes('₹49'))throw e;
        await payFeature('super_like',`Super Like ${name} · ₹49`);
        return api('/api/super-likes/use',{method:'POST',body:{targetId}});
      });
      toast(result.matched?'⭐ Super Like matched! 💞':'⭐ Super Like sent!');
      if(result.matched && window.showMatchCelebration)window.showMatchCelebration({id:targetId,name});
      else if(window.render)window.render('home');
    }catch(e){toast(e.message)}
  }
  async function sendSuperLike(index){
    const list=await getDiscover();
    const x=list[index];
    if(!x)return;
    return sendSuperLikeTarget(x.id,x.name);
  }

  async function buyBoost(){
    try{
      await payFeature('boost','VibeMeet Boost · 6 hours');
      toast('🚀 Boost activated for 6 hours!');
      if(window.render)window.render('home');
    }catch(e){toast(e.message)}
  }

  async function rewindLast(){
    try{
      const r=await api('/api/swipes/rewind',{method:'POST'});
      toast(`↩️ Rewound ${r.name||'your last swipe'}`);
      if(window.render)window.render('home');
    }catch(e){toast(e.message)}
  }

  window.sendSuperLike=sendSuperLike;
  window.sendSuperLikeTarget=sendSuperLikeTarget;
  window.buyBoost=buyBoost;
  window.rewindLast=rewindLast;
  async function sendCompliment(id,name){
    const body=prompt(`Send a compliment to ${name} (max 150 characters)`);
    if(!body?.trim())return;
    try{await api('/api/compliments',{method:'POST',body:{receiverId:id,body:body.trim()}});toast('💌 Compliment sent!');}
    catch(e){toast(e.message)}
  }
  async function toggleIncognito(){
    const u=getUser()||{};
    try{const next=!u.incognito_enabled;const r=await api('/api/me/privacy',{method:'POST',body:{incognito_enabled:next}});localStorage.setItem('vm_user',JSON.stringify({...u,incognito_enabled:r.incognito_enabled}));toast(next?'🕶️ Incognito mode on':'👀 Incognito mode off');if(window.render)window.render('profile')}catch(e){toast(e.message)}
  }
  async function setTravelMode(){
    const u=getUser()||{};
    const city=prompt('Travel Mode city (leave blank to turn it off):',u.travel_city||'');
    if(city===null)return;
    try{const r=await api('/api/me/travel',{method:'POST',body:{city}});localStorage.setItem('vm_user',JSON.stringify({...u,travel_city:r.travel_city||null}));toast(r.travel_city?`✈️ Travel Mode: ${r.travel_city}`:'Travel Mode off');if(window.render)window.render('home')}catch(e){toast(e.message)}
  }
  async function snoozeProfile(){
    try{const r=await api('/api/me/snooze',{method:'POST'});const u=getUser()||{};localStorage.setItem('vm_user',JSON.stringify({...u,snoozed_until:r.snoozed_until}));toast('🌙 Profile snoozed for 24 hours');if(window.render)window.render('profile')}catch(e){toast(e.message)}
  }
  window.sendCompliment=sendCompliment;
  window.toggleIncognito=toggleIncognito;
  window.snoozeProfile=snoozeProfile;
  window.setTravelMode=setTravelMode;

  const originalSwipe=window.swipe;
  if(typeof originalSwipe==='function'){
    window.swipe=async function(i,direction){
      return originalSwipe(i,direction);
    };
  }

  function injectHomeTools(){
    const page=document.getElementById('page');
    if(!page||!page.querySelector('.discoverPage')||page.querySelector('.vmPowerupBar'))return;
    const hero=page.querySelector('.discoverHero');
    if(!hero)return;
    const viewBtn=page.querySelector('.discoverActions .viewAction');
    const targetId=viewBtn?.getAttribute('onclick')?.match(/viewProfile\((\d+)/)?.[1];
    const nameEl=page.querySelector('.featuredInfo h3');
    const targetName=nameEl?.textContent?.replace(/^About\s+/,'').trim()||'this profile';
    if(!targetId)return;
    const bar=document.createElement('div');
    bar.className='vmPowerupBar';
    bar.innerHTML=`
      <button class="vmPowerupBtn star" onclick="sendSuperLikeTarget(${Number(targetId)},'${esc(targetName).replace(/'/g,"\'")}')">⭐ Super Like · ₹49</button>
      <button class="vmPowerupBtn boost" onclick="buyBoost()">🚀 Boost my profile · ₹99</button>
      <button class="vmPowerupBtn rewind" onclick="rewindLast()">↩️ Rewind last swipe</button>
    `;
    hero.insertAdjacentElement('afterend',bar);

    const actions=page.querySelector('.discoverActions');
    if(actions&&!actions.querySelector('.superLikeAction')){
      const b=document.createElement('button');
      b.className='swipeButton superLikeAction';
      b.title='Send Super Like';
      b.innerHTML='<span>⭐</span><b>Super</b>';
      b.onclick=()=>sendSuperLikeTarget(Number(targetId),targetName);
      actions.insertBefore(b,actions.lastElementChild);
    }
  }

  function injectMatchTools(){
    const page=document.getElementById('page');
    if(!page||!page.querySelector('.matchesPage')||page.querySelector('.vmPremiumPanel'))return;
    const tabs=page.querySelector('.matchTabs');
    if(!tabs)return;
    const panel=document.createElement('section');
    panel.className='vmPremiumPanel';
    panel.innerHTML=`
      <div class="vmPremiumPanelHead">
        <div><div class="eyebrow">VIBEMEET POWER-UPS</div><b>Make your profile stand out</b><div class="muted" style="font-size:12px;margin-top:3px">Professional dating controls inspired by modern dating apps.</div></div>
        <button class="secondary" onclick="render('vip')">💎 VIP</button>
      </div>
      <div class="vmPremiumGrid">
        <div class="vmPremiumTile"><b>⭐ Super Like</b><small>Tell someone you're especially interested. ₹49 each.</small></div>
        <div class="vmPremiumTile"><b>🚀 Boost</b><small>Move your profile higher in discovery for 6 hours. ₹99.</small></div>
        <div class="vmPremiumTile"><b>💌 Likes You</b><small>VIP unlocks all incoming likes; free users get a limited preview.</small></div>
      </div>`;
    tabs.parentNode.insertBefore(panel,tabs);
  }

  const originalViewProfile=window.viewProfile;
  if(typeof originalViewProfile==='function')window.viewProfile=async function(id,...args){api(`/api/profile-views/${id}`,{method:'POST'}).catch(()=>{});return originalViewProfile.call(this,id,...args)};

  function injectProfileTools(){
    const page=document.getElementById('page');
    if(!page||!page.querySelector('.profilePage')||page.querySelector('.vmProfileTools'))return;
    const complete=page.querySelector('.profileLayout');
    if(!complete)return;
    const u=getUser()||{};
    const card=document.createElement('div');
    card.className='card vmProfileTools';
    card.style.marginTop='16px';
    card.innerHTML=`<div class="eyebrow">PRIVACY & VISIBILITY</div><h3>Control who sees you</h3><p class="muted">Browse privately or take a short break without deleting your profile.</p><div class="vmActionRow"><button class="secondary" onclick="toggleIncognito()">${u.incognito_enabled?'👀 Turn off Incognito':'🕶️ Turn on Incognito'}</button><button class="secondary" onclick="snoozeProfile()">🌙 Snooze 24h</button><button class="secondary" onclick="setTravelMode()">✈️ Travel Mode</button><button class="primary" onclick="buyBoost()">🚀 Boost · ₹99</button></div>`;
    complete.insertAdjacentElement('afterend',card);
  }

  function injectPublicProfileTools(){
    const page=document.getElementById('page');
    if(!page||!page.querySelector('.publicProfileCard')||page.querySelector('.vmComplimentBtn'))return;
    const actions=page.querySelector('.publicProfileCard .actions');
    const heading=page.querySelector('.publicProfileCard h1');
    if(!actions||!heading)return;
    const idMatch=actions.querySelector('[onclick*="messageUser("]');
    const id=idMatch?.getAttribute('onclick')?.match(/messageUser\((\d+)/)?.[1];
    if(!id)return;
    const name=heading.textContent.replace(/✓/g,'').trim();
    const b=document.createElement('button');b.className='secondary vmComplimentBtn';b.textContent='💌 Compliment';b.onclick=()=>sendCompliment(Number(id),name);actions.insertBefore(b,actions.firstChild);
  }

  const originalRenderHome=window.renderHome;
  if(typeof originalRenderHome==='function')window.renderHome=async function(){const r=await originalRenderHome.apply(this,arguments);injectHomeTools();return r};
  const originalRenderMatches=window.renderMatches;
  if(typeof originalRenderMatches==='function')window.renderMatches=async function(){const r=await originalRenderMatches.apply(this,arguments);injectMatchTools();return r};

  const observer=new MutationObserver(()=>{injectHomeTools();injectMatchTools();injectProfileTools();injectPublicProfileTools()});
  observer.observe(document.getElementById('page')||document.body,{childList:true,subtree:true});

  window.addEventListener('load',()=>{setTimeout(()=>{injectHomeTools();injectMatchTools();injectProfileTools();injectPublicProfileTools()},500)});
})();
