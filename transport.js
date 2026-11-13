export function createTransportSelector({proxyUrl,healthUrl,retrySeconds=60,fetchImpl=fetch,now=Date.now}={}) {
  let next='direct', blockedUntil=0, health=proxyUrl?'checking':'disabled';
  return {
    async take(){
      if(!proxyUrl)return {name:'direct'};
      if(next==='direct'){next='vpn';return {name:'direct'};}
      if(now()<blockedUntil)return {name:'direct'};
      if(healthUrl){
        try {
          const response=await fetchImpl(healthUrl,{signal:AbortSignal.timeout(3000)});
          if(!response.ok)throw Error('VPN not ready');
          const status=await response.json();
          if(status.healthy!==true)throw Error('VPN not ready');
        } catch {
          health='unavailable';blockedUntil=now()+retrySeconds*1000;return {name:'direct'};
        }
      }
      health='ready';next='direct';return {name:'vpn',proxyUrl};
    },
    failed(route){if(route.name==='vpn'){health='unavailable';blockedUntil=now()+retrySeconds*1000;next='vpn';}},
    status(){return {vpnConfigured:Boolean(proxyUrl),vpn:health,retryAt:blockedUntil>now()?new Date(blockedUntil).toISOString():null};}
  };
}
