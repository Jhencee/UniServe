// Set window.UNISERVE_API_BASE before this script when using a separate API host.
(function(){
  const original=window.fetch.bind(window),local='http://127.0.0.1:8000/api';
  const base=window.UNISERVE_API_BASE||(location.protocol==='file:'?local:location.protocol==='https:'?location.origin+'/api':location.protocol+'//'+location.hostname+':8000/api');
  window.UniServeConfig=Object.freeze({apiBase:base.replace(/\/$/,'')});
  window.fetch=function(input,options){return original(typeof input==='string'&&input.startsWith(local)?base+input.slice(local.length):input,options);};
})();
