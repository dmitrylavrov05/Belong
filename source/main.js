(function(){
"use strict";
var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- живая карта в шапке ---------- */
var cv=document.getElementById("map");
if(cv){
  var ctx=cv.getContext("2d"),W=0,H=0,C={},ANG=-0.32,SP=70,co=Math.cos(ANG),si=Math.sin(ANG),R=18,cx=0,cy=0;
  var seed=11;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
  var mA=[-4,-1,2,5],mB=[-5,-2,1,4];
  var parks=[];for(var i=0;i<9;i++)parks.push([(rnd()-.5)*18,(rnd()-.5)*12]);
  function colors(){var s=getComputedStyle(document.documentElement);["map","road","road-edge","water","park","car","ok"].forEach(function(k){C[k]=s.getPropertyValue("--"+k).trim()})}
  function P(u,v){return[cx+u*SP*co-v*SP*si,cy+u*SP*si+v*SP*co]}
  function size(){var r=cv.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);W=r.width;H=r.height;cv.width=W*d;cv.height=H*d;ctx.setTransform(d,0,0,d,0,0);cx=W*.62;cy=H*.5}
  var cars=[];for(var j=0;j<22;j++){var dir=rnd()<.5?0:1,pool=(dir?mB:mA).concat([Math.round((rnd()-.5)*14)]);cars.push({d:dir,k:pool[Math.floor(rnd()*pool.length)],t:(rnd()-.5)*2*R,s:(rnd()<.5?-1:1)*(.006+rnd()*.012),l:rnd()<.5?-.06:.06})}
  function draw(){
    ctx.fillStyle=C.map;ctx.fillRect(0,0,W,H);
    ctx.fillStyle=C.park;parks.forEach(function(p){var a=P(p[0],p[1]);ctx.beginPath();if(ctx.roundRect)ctx.roundRect(a[0]-50,a[1]-34,100,68,18);else ctx.rect(a[0]-50,a[1]-34,100,68);ctx.fill()});
    ctx.strokeStyle=C.water;ctx.lineWidth=34;ctx.lineCap="round";ctx.beginPath();
    var a=P(-R,5),b=P(-5,-3),c=P(5,8),e=P(R,2);ctx.moveTo(a[0],a[1]);ctx.bezierCurveTo(b[0],b[1],c[0],c[1],e[0],e[1]);ctx.stroke();
    ctx.lineCap="butt";
    for(var pass=0;pass<2;pass++)for(var k=-R;k<=R;k++){
      [[0,mA],[1,mB]].forEach(function(o){var m=o[1].indexOf(k)>-1;ctx.strokeStyle=pass?C.road:C["road-edge"];ctx.lineWidth=(m?12:5)+(pass?0:3);
        var s=o[0]?P(k,-R):P(-R,k),t=o[0]?P(k,R):P(R,k);ctx.beginPath();ctx.moveTo(s[0],s[1]);ctx.lineTo(t[0],t[1]);ctx.stroke()});
    }
    cars.forEach(function(c,n){
      if(!reduce){c.t+=c.s;if(c.t>R)c.t=-R;if(c.t<-R)c.t=R}
      var p=c.d?P(c.k+c.l,c.t):P(c.t,c.k+c.l),ang=ANG+(c.d?Math.PI/2:0)+(c.s<0?Math.PI:0);
      ctx.save();ctx.translate(p[0],p[1]);ctx.rotate(ang);ctx.fillStyle=n%7===0?C.ok:C.car;ctx.beginPath();
      if(ctx.roundRect)ctx.roundRect(-9,-5,18,10,3);else ctx.rect(-9,-5,18,10);ctx.fill();ctx.restore();
    });
  }
  var visible=true;
  if("IntersectionObserver" in window)new IntersectionObserver(function(e){visible=e[0].isIntersecting}).observe(cv);
  function loop(){if(visible)draw();requestAnimationFrame(loop)}
  colors();size();draw();if(!reduce)requestAnimationFrame(loop);
  addEventListener("resize",function(){size();draw()});
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){colors();draw()});
}

/* ---------- маршрут и цена ---------- */
var RATE={hour:600,km:27,loader:300,minH:2};
var CENTER=[49.9935,36.2304],CITY_R=14; // км от центра Харькова считаются городом
var PREVIEW=!!document.body.dataset.preview;
// Демо-адреса для превью (в превью внешние сервисы недоступны)
var DEMO=[["Площа Свободи, Харків",49.9926,36.2311],["м. Героїв Праці, Салтівка",50.0275,36.3355],["м. Олексіївська, Олексіївка",50.0505,36.2006],["м. Холодна Гора",49.9830,36.1880],["м. Тракторний завод, ХТЗ",49.9825,36.3460],["Південний вокзал, Харків",49.9897,36.2063],["П'ятихатки, Харків",50.0790,36.2700],["м. Індустріальна, Нові Будинки",49.9480,36.4000],["Основа, Харків",49.9370,36.2380],["Рогань, Харків",49.9150,36.4500],["Павлове Поле, Харків",50.0220,36.2190],["Пісочин",49.9570,36.0960],["Мерефа",49.8220,36.0520],["Чугуїв",49.8360,36.6880],["Полтава",49.5883,34.5514],["Дніпро",48.4647,35.0462],["Київ",50.4501,30.5234]];
function hav(a,b){var R=6371,r=Math.PI/180,dl=(b[0]-a[0])*r,dn=(b[1]-a[1])*r,x=Math.sin(dl/2)*Math.sin(dl/2)+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dn/2)*Math.sin(dn/2);return 2*R*Math.asin(Math.sqrt(x))}
function geocode(q){
  if(PREVIEW){var ql=q.toLowerCase();return Promise.resolve(DEMO.filter(function(d){return d[0].toLowerCase().indexOf(ql)>-1}).slice(0,6).map(function(d){return{name:d[0],sub:"",ll:[d[1],d[2]]}}))}
  var url="https://photon.komoot.io/api/?limit=6&lat="+CENTER[0]+"&lon="+CENTER[1]+"&q="+encodeURIComponent(q);
  return fetch(url).then(function(r){return r.json()}).then(function(j){return(j.features||[]).filter(function(f){return f.properties.countrycode==="UA"}).map(function(f){var p=f.properties;
    var main=[p.street||p.name,p.housenumber].filter(Boolean).join(", ")||p.name;var sub=[p.street&&p.name&&p.name!==p.street?p.name:null,p.city||p.town||p.village,p.state].filter(Boolean).join(", ");
    return{name:main,sub:sub,ll:[f.geometry.coordinates[1],f.geometry.coordinates[0]]}})});
}
function route(a,b){
  if(PREVIEW){var d=hav(a,b)*1.3;return Promise.resolve({km:d,min:d<20?d*2.4+8:d*0.95+10})}
  var url="https://router.project-osrm.org/route/v1/driving/"+a[1]+","+a[0]+";"+b[1]+","+b[0]+"?overview=false";
  return fetch(url).then(function(r){return r.json()}).then(function(j){if(!j.routes||!j.routes[0])throw 0;return{km:j.routes[0].distance/1000,min:j.routes[0].duration/60}});
}
function quote(a,b,r,loaders){
  var city=hav(a,CENTER)<CITY_R&&hav(b,CENTER)<CITY_R,h,km=0;
  if(city){h=Math.max(RATE.minH,Math.ceil((r.min+60)/60))}else{h=RATE.minH;km=Math.round(r.km)}
  var car=h*RATE.hour,mil=km*RATE.km,ldr=loaders*h*RATE.loader;
  return{city:city,h:h,km:km,car:car,mil:mil,ldr:ldr,total:car+mil+ldr};
}
var ord=document.querySelector(".order");
if(ord){
  var L=JSON.parse(ord.dataset.i18n),pts={from:null,to:null},last=null;
  var est=ord.querySelector("#est"),ldrIn=ord.querySelector("#ldr"),ldrOut=ord.querySelector("#ldrOut");
  var money=function(n){return n.toLocaleString("uk-UA").replace(/[\s, ]/g," ")+" грн"};
  var isGazel=function(){var c=ord.querySelector('input[name="vehicle"]:checked');return !c||c.closest(".ride")===ord.querySelector(".ride")};
  var render=function(){
    if(!last){est.hidden=true;var c0=ord.querySelector(".cta .cl");if(c0)c0.textContent=c0.dataset.def;ord.dispatchEvent(new Event("routechange"));return}
    est.hidden=false;
    if(last.err){est.innerHTML='<p class="muted">'+last.err+'</p>';ord.querySelector("#priceInfo").value="";return}
    var q=quote(pts.from.ll,pts.to.ll,last.r,+ldrIn.value);
    var rows='<div class="erow"><span>'+L.car+' · '+q.h+' '+L.h+(q.h===2?' ('+L.min2+')':'')+'</span><b>'+money(q.car)+'</b></div>';
    if(q.mil)rows+='<div class="erow"><span>'+L.mileage+' · '+q.km+' '+L.km+'</span><b>'+money(q.mil)+'</b></div>';
    if(q.ldr)rows+='<div class="erow"><span>'+L.ldr+' · '+ldrIn.value+' × '+q.h+' '+L.h+'</span><b>'+money(q.ldr)+'</b></div>';
    var gz=isGazel(),disc=Math.round(q.total*0.1),fin=q.total-disc;
    rows+='<div class="erow disc"><span>'+L.d_row+'</span><b>−'+money(disc)+'</b></div>';
    est.innerHTML='<div class="etop"><span class="emeta">'+last.r.km.toFixed(1).replace(".",",")+' '+L.km+' · '+Math.round(last.r.min)+' '+L.min+'</span>'+
      '<span class="etot"><small><s>'+money(q.total)+'</s><em>'+L.d_big+'</em></small><b>'+money(fin)+'</b></span></div>'+rows+
      '<p class="esave"><span>'+L.d_save+' <b>'+money(disc)+'</b></span><span class="muted">'+L.fixed+'</span></p>';
    var b=est.querySelector(".etot b");if(b){b.classList.remove("bump");void b.offsetWidth;b.classList.add("bump")}
    ord.querySelector("#routeInfo").value=pts.from.name+" → "+pts.to.name+" ("+last.r.km.toFixed(1)+" km)";
    ord.querySelector("#priceInfo").value=fin+" UAH";ord.querySelector("#discInfo").value="-10%: "+disc+" UAH (без знижки "+q.total+" UAH)";
    var cl=ord.querySelector(".cta .cl");if(cl)cl.textContent=L.order_for+" "+money(fin);
    ord.dispatchEvent(new Event("routechange"));
  };
  var recalc=function(){
    if(!pts.from||!pts.to){last=null;render();return}
    est.hidden=false;est.innerHTML='<p class="muted">'+L.calc+'</p><div class="bar"><i></i></div>';
    route(pts.from.ll,pts.to.ll).then(function(r){last={r:r};render()},function(){last={err:L.noroute};render()});
  };
  ord.querySelectorAll(".addr").forEach(function(box){
    var inp=box.querySelector("input"),ul=box.querySelector(".sug"),key=inp.id,t=null,items=[],act=-1;
    var close=function(){ul.hidden=true;act=-1};
    var pick=function(it){inp.value=it.name+(it.sub?", "+it.sub:"");pts[key]=it;close();box.classList.add("set");recalc();
      if(key==="from"){var nx=ord.querySelector("#to");if(!nx.value)nx.focus()}};
    var show=function(list){items=list;ul.innerHTML="";
      if(!list.length){ul.innerHTML='<li class="none">'+L.nores+'</li>';ul.hidden=false;return}
      list.forEach(function(it,i){var li=document.createElement("li");li.setAttribute("role","option");
        var b=document.createElement("b");b.textContent=it.name;li.appendChild(b);
        if(it.sub){var sm=document.createElement("small");sm.textContent=it.sub;li.appendChild(sm)}
        li.addEventListener("mousedown",function(e){e.preventDefault();pick(it)});ul.appendChild(li)});
      ul.hidden=false};
    inp.addEventListener("input",function(){pts[key]=null;box.classList.remove("set");last=null;render();clearTimeout(t);
      var q=inp.value.trim();if(q.length<3){close();return}
      t=setTimeout(function(){geocode(q).then(show,function(){close()})},300)});
    inp.addEventListener("keydown",function(e){var lis=ul.querySelectorAll("li[role=option]");if(ul.hidden||!lis.length)return;
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();act=(act+(e.key==="ArrowDown"?1:-1)+lis.length)%lis.length;lis.forEach(function(l,i){l.classList.toggle("on",i===act)})}
      else if(e.key==="Enter"&&act>-1){e.preventDefault();pick(items[act])}else if(e.key==="Escape")close()});
    inp.addEventListener("blur",function(){setTimeout(close,150)});
  });
  ord.querySelectorAll(".step button").forEach(function(b){b.addEventListener("click",function(){
    var v=Math.min(6,Math.max(0,+ldrIn.value+(+b.dataset.d)));ldrIn.value=v;ldrOut.textContent=v;render()})});
  ord.querySelectorAll('input[name="vehicle"]').forEach(function(r){r.addEventListener("change",render)});
  ord._routeOk=function(){return !!(pts.from&&pts.to)};
  ord._priced=function(){return !!(last&&last.r)};
  ord._errAddr=L.err_addr;
}


/* ---------- подсказки: что делать дальше ---------- */
if(ord){
  var G=JSON.parse(ord.dataset.i18n),fromI=ord.querySelector("#from"),toI=ord.querySelector("#to"),phI=ord.querySelector("#phone"),cta=ord.querySelector(".cta");
  var prog=ord.querySelectorAll(".prog li"),hint=ord.querySelector(".hint");
  var started=false;
  var stage=function(){
    if(!ord._routeOk())return fromI.parentNode.classList.contains("set")?1:0;
    if(phI.value.replace(/\D/g,"").length!==9)return 2;
    return 3;
  };
  var say=function(t){if(!hint||hint.textContent===t)return;hint.classList.remove("in");void hint.offsetWidth;hint.textContent=t;hint.classList.add("in")};
  var update=function(){
    var st=stage();
    prog.forEach(function(li,i){li.classList.toggle("done",i<st||(i===1&&ord._priced()&&st>=2));li.classList.toggle("now",i===Math.min(st,2)&&st<3)});
    ord.querySelectorAll(".glow").forEach(function(e){e.classList.remove("glow")});
    cta.classList.toggle("ready",st===3);
    say([G.h_from,G.h_to,G.h_phone,G.h_ready][st]);
    jumpTxt();
    if(!started&&st===0)return;
    if(st===0)fromI.parentNode.classList.add("glow");
    else if(st===1)toI.parentNode.classList.add("glow");
    else if(st===2)ord.querySelector(".field").classList.add("glow");
  };
  // старт: через мгновение после загрузки подсвечиваем первое поле
  setTimeout(function(){started=true;update()},reduce?0:900);
  ["input","change","click","focusin"].forEach(function(ev){ord.addEventListener(ev,function(){setTimeout(update,0)})});
  ord.addEventListener("routechange",update);

  // печатающиеся примеры адресов в пустом поле
  var ex=G.ex,ei=0,ci=0,del=false,base=fromI.placeholder,typing=null;
  var tick=function(){
    if(fromI.value||document.activeElement===fromI){fromI.placeholder=base;typing=setTimeout(tick,1200);return}
    var w=ex[ei];
    if(!del){ci++;fromI.placeholder=w.slice(0,ci);if(ci>=w.length){del=true;typing=setTimeout(tick,1600);return}}
    else{ci--;fromI.placeholder=w.slice(0,ci)||" ";if(ci<=0){del=false;ei=(ei+1)%ex.length}}
    typing=setTimeout(tick,del?35:85);
  };
  if(!reduce)typing=setTimeout(tick,1400);

  // плавающая кнопка, когда форма вне экрана
  var jump=document.createElement("button");jump.type="button";jump.className="jump";jump.hidden=true;
  jump.innerHTML='<span class="jdot"></span><span class="jt"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  document.body.appendChild(jump);
  var jumpTxt=function(){var st=stage();jump.querySelector(".jt").textContent=st===0?G.jump:(st===3?G.h_ready:(st===1?G.h_to:G.h_phone))};
  var goForm=function(){
    ord.scrollIntoView({behavior:reduce?"auto":"smooth",block:"center"});
    var st=stage(),t=st===0?fromI:st===1?toI:st===2?phI:cta;setTimeout(function(){t.focus({preventScroll:true})},reduce?0:450);
    ord.classList.remove("ping");void ord.offsetWidth;ord.classList.add("ping");
  };
  jump.addEventListener("click",goForm);
  if("IntersectionObserver" in window){
    var seen=false;
    new IntersectionObserver(function(e){var vis=e[0].isIntersecting;if(vis)seen=true;jump.hidden=vis||!seen&&scrollY<80;jump.classList.toggle("in",!jump.hidden)},{threshold:.25}).observe(ord);
    addEventListener("scroll",function(){if(!seen&&scrollY>200){seen=true;jump.hidden=false;jump.classList.add("in")}},{passive:true});
  }

  // мягкое напоминание, если клиент читает, но не начал заказ
  var nudged=false;try{nudged=sessionStorage.getItem("nudged")==="1"}catch(_){}
  var idle=null,resetIdle=function(){clearTimeout(idle);if(nudged||stage()>0)return;idle=setTimeout(showNudge,25000)};
  var showNudge=function(){
    if(nudged||stage()>0)return;nudged=true;try{sessionStorage.setItem("nudged","1")}catch(_){}
    var n=document.createElement("div");n.className="nudge";n.setAttribute("role","dialog");
    n.innerHTML='<p></p><div><button type="button" class="nb">'+'</button><button type="button" class="nx" aria-label="×">×</button></div>';
    n.querySelector("p").textContent=G.nudge;n.querySelector(".nb").textContent=G.nudge_btn;
    n.querySelector(".nb").addEventListener("click",function(){n.remove();goForm()});
    n.querySelector(".nx").addEventListener("click",function(){n.classList.add("out");setTimeout(function(){n.remove()},300)});
    document.body.appendChild(n);
  };
  ["scroll","mousemove","keydown","touchstart"].forEach(function(ev){addEventListener(ev,resetIdle,{passive:true})});
  resetIdle();
}


/* ---------- кнопки "к форме" ---------- */
document.querySelectorAll("[data-focus]").forEach(function(a){a.addEventListener("click",function(e){
  var o=document.querySelector(".order");if(!o)return;e.preventDefault();
  o.scrollIntoView({behavior:reduce?"auto":"smooth",block:"center"});
  var t=document.getElementById(a.dataset.focus);if(t)setTimeout(function(){t.focus({preventScroll:true})},reduce?0:450);
  o.classList.remove("ping");void o.offsetWidth;o.classList.add("ping");
})});

/* ---------- превью: переходы между страницами внутри просмотрщика ---------- */
if(document.body.dataset.preview&&!window.__router){
  window.__router=true;
  // стили держим в <head> с абсолютными адресами, чтобы смена страницы их не удаляла
  var keepStyles=function(root,baseUrl){
    root.querySelectorAll('link[rel="stylesheet"],link[rel="preconnect"]').forEach(function(l){
      var abs=new URL(l.getAttribute("href"),baseUrl).href;
      if(!document.head.querySelector('link[href="'+abs+'"]')){var n=document.createElement("link");n.rel=l.rel;n.href=abs;if(l.crossOrigin)n.crossOrigin=l.crossOrigin;document.head.appendChild(n)}
      if(l.ownerDocument===document)l.remove();
    });
  };
  keepStyles(document,document.baseURI);
  var go=function(url){
    var target=url.pathname.endsWith("/")?new URL("index.html",url):url;
    document.documentElement.classList.add("navigating");
    fetch(target.href).then(function(r){if(!r.ok)throw 0;return r.text()}).then(function(html){
      var d=new DOMParser().parseFromString(html,"text/html");
      keepStyles(d,target.href);
      d.body.querySelectorAll('link[rel="stylesheet"],link[rel="preconnect"]').forEach(function(l){l.remove()});
      var base=document.querySelector("base")||document.head.appendChild(document.createElement("base"));
      base.href=new URL(".",target).href;
      if(d.title)document.title=d.title;
      var scr=d.body.querySelector('script[src*="main.js"]'),src=scr?scr.getAttribute("src"):null;
      d.body.querySelectorAll("script").forEach(function(s){s.remove()});
      document.body.innerHTML=d.body.innerHTML;document.body.dataset.preview="1";
      window.scrollTo(0,0);
      if(url.hash){var el=document.getElementById(url.hash.slice(1));if(el)setTimeout(function(){el.scrollIntoView()},50)}
      if(src){var ns=document.createElement("script");ns.src=new URL(src,target).href+"?r="+Date.now();document.body.appendChild(ns)}
      document.documentElement.classList.remove("navigating");
    }).catch(function(){document.documentElement.classList.remove("navigating")});
  };
  document.addEventListener("click",function(e){
    var a=e.target.closest("a");if(!a||e.defaultPrevented||a.target==="_blank")return;
    var h=a.getAttribute("href");if(!h||/^(https?:|tel:|mailto:|sms:)/.test(h))return;
    if(h.charAt(0)==="#")return;
    var url=new URL(h,document.baseURI);
    var here=new URL(location.href);
    e.preventDefault();
    go(url);
  });
}
/* ---------- форма заявки ---------- */
var f=document.getElementById("order");
if(!f)return;
var ph=f.querySelector("#phone"),err=f.querySelector(".err"),field=f.querySelector(".field"),btn=f.querySelector(".cta"),T=f.dataset;
ph.addEventListener("input",function(){
  var d=ph.value.replace(/\D/g,"");if(d.indexOf("380")===0)d=d.slice(3);else if(d.charAt(0)==="0")d=d.slice(1);d=d.slice(0,9);
  ph.value=[d.slice(0,2),d.slice(2,5),d.slice(5,7),d.slice(7,9)].filter(Boolean).join(" ");err.hidden=true;
});
function fmt(d){return"+380 "+d.slice(0,2)+" "+d.slice(2,5)+" "+d.slice(5,7)+" "+d.slice(7,9)}
function done(phone){
  var box=document.createElement("div");box.className="done";
  box.innerHTML='<svg class="check" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32"/><path d="M20 33l8 8 16-17"/></svg><h2></h2><p class="muted"></p><div class="sum"></div><button type="button" class="ghost"></button>';
  box.querySelector("h2").textContent=T.okH;
  var p=box.querySelector("p");p.textContent=T.okP+" ";var ps=document.createElement("span");ps.className="nowrap";ps.textContent=phone;p.appendChild(ps);
  var oc=document.querySelector(".order"),L2=oc?JSON.parse(oc.dataset.i18n):{},sum=box.querySelector(".sum");
  var row=function(k,v,big){if(!v)return;var d=document.createElement("div"),s=document.createElement("span"),b=document.createElement("b");s.textContent=k;b.textContent=v;if(big)b.className="big";d.append(s,b);sum.appendChild(d)};
  var fr=f.querySelector("#from"),to=f.querySelector("#to"),pr=f.querySelector("#priceInfo"),ld=f.querySelector("#ldr");
  if(fr)row(L2.from,fr.value);if(to)row(L2.to,to.value);
  if(ld&&+ld.value)row(L2.ldr,ld.value);
  var di=f.querySelector("#discInfo");if(di&&di.value){var dm=di.value.match(/: (\d+)/);if(dm)row(L2.d_row,"−"+(+dm[1]).toLocaleString("uk-UA").replace(/[\s,\u00a0]/g,"\u00a0")+"\u00a0грн")}
  if(pr&&pr.value)row(L2.approx,(+pr.value.replace(/\D/g,"")).toLocaleString("uk-UA").replace(/[\s,\u00a0]/g," ")+" грн",true);
  if(!sum.children.length)sum.remove();
  box.querySelector("button").textContent=T.again;
  box.querySelector("button").addEventListener("click",function(){box.remove();f.hidden=false;ph.value="";btn.disabled=false;btn.innerHTML=btnHTML});
  f.hidden=true;f.parentNode.appendChild(box);
  box.scrollIntoView({behavior:reduce?"auto":"smooth",block:"center"});
}
var btnHTML=btn.innerHTML;
f.addEventListener("submit",function(e){
  e.preventDefault();
  var d=ph.value.replace(/\D/g,"");
  var oc=document.querySelector(".order");
  if(oc&&oc._routeOk&&!oc._routeOk()){err.textContent=oc._errAddr;err.hidden=false;var fi=f.querySelector(pts.from?"#to":"#from");fi&&fi.focus();return}
  if(d.length!==9){err.textContent=T.errPhone;err.hidden=false;field.classList.remove("shake");void field.offsetWidth;field.classList.add("shake");ph.focus();return}
  btnHTML=btn.innerHTML;btn.disabled=true;btn.innerHTML='<span style="display:grid;gap:8px;width:100%;justify-items:center">'+T.s1+'<span class="bar" style="width:60%"><i></i></span></span>';
  var data=new FormData(f);data.set("phone",fmt(d));
  var wait=new Promise(function(r){setTimeout(r,1400)});
  if(document.body.dataset.preview){wait.then(function(){done(fmt(d))});return}
  var send=fetch("/api/order",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(data).toString()})
    .then(function(r){if(!r.ok)throw 0});
  Promise.all([send,wait]).then(function(){done(fmt(d))},function(){
    btn.disabled=false;btn.innerHTML=btnHTML;err.textContent=T.fail;err.hidden=false;
  });
});
})();
