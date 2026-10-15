(function(){var b=(document.currentScript&&document.currentScript.src)?new URL(document.currentScript.src).origin:location.origin;customElements.get("lt-v2")||customElements.define("lt-v2",class extends HTMLElement{connectedCallback(){const e=this.attachShadow({mode:"open"}),t=this.getAttribute.bind(this),a=t("v")||"",i=t("ar")||"16:9";

const p=new URLSearchParams();p.set("ar",i);
const skip=new Set(["v","ar","class","style","id"]);
for(const attr of this.attributes){if(!skip.has(attr.name))p.set(attr.name,attr.value);}
const legacy=t("p");if(legacy)legacy.split("&").forEach(function(pair){var kv=pair.split("=");if(kv[0])p.set(kv[0],kv[1]||"");});
let o="16/9";if(i==="square")o="1/1";else if(i.includes(":"))o=i.replace(":","/");else o=i;
e.innerHTML=`<style>:host{display:block;max-width:1280px;margin:auto}.v{position:relative;width:100%;aspect-ratio:${o};overflow:hidden;border-radius:8px;background:#000}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style><div class="v"><iframe src="${b}/embed/${a}?${p.toString()}" loading="lazy" allowfullscreen></iframe></div>`}})})();