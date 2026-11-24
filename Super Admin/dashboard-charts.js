/* Aggregate dashboard charts. No visitor identities or external chart services. */
const superChartEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function superGroupedColumns(labels,series,label){
  const max=Math.max(1,...series.flatMap(s=>s.values)),left=36,right=464,top=20,bottom=164;
  const groupWidth=(right-left)/Math.max(1,labels.length),barWidth=Math.min(30,groupWidth/(series.length+2));
  const ticks=[...new Set([0,Math.ceil(max/2),max])];
  const grid=ticks.map(value=>{const y=bottom-value/max*(bottom-top);return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="var(--border)"/><text x="${left-8}" y="${y+4}" text-anchor="end">${value}</text>`;}).join('');
  const bars=labels.map((name,index)=>{
    const center=left+groupWidth*(index+.5);
    return series.map((s,j)=>{const count=s.values[index]||0,height=count/max*(bottom-top),x=center+(j-series.length/2)*barWidth;
      return `<g><title>${superChartEscape(name)} · ${superChartEscape(s.label)}: ${count}</title><rect x="${x}" y="${bottom-height}" width="${barWidth-4}" height="${height}" rx="3" fill="${s.color}"/><text x="${x+(barWidth-4)/2}" y="${bottom-height-7}" text-anchor="middle">${count}</text></g>`;
    }).join('')+`<text x="${center}" y="190" text-anchor="middle">${superChartEscape(name)}</text>`;
  }).join('');
  return `<div class="super-grouped-chart"><svg viewBox="0 0 480 205" role="img" aria-label="${superChartEscape(label)}">${grid}${bars}</svg><div class="super-chart-key">${series.map(s=>`<span><i style="background:${s.color}"></i>${superChartEscape(s.label)}</span>`).join('')}</div></div>`;
}
function superPieChart(rows,label){
  const colors=['var(--super-chart-1)','var(--super-chart-2)','var(--super-chart-3)'],total=rows.reduce((sum,r)=>sum+r.count,0);let offset=0;
  const slices=rows.map((row,index)=>{
    if(!row.count)return '';
    const share=total?row.count/total:0,start=offset;offset+=share;
    if(share===1)return `<circle cx="70" cy="70" r="58" fill="${colors[index%colors.length]}"><title>${superChartEscape(row.label)}: ${row.count}</title></circle>`;
    const point=value=>[70+58*Math.cos(value*2*Math.PI-Math.PI/2),70+58*Math.sin(value*2*Math.PI-Math.PI/2)];
    return `<path d="M70 70 L${point(start).join(' ')} A58 58 0 ${share>.5?1:0} 1 ${point(offset).join(' ')} Z" fill="${colors[index%colors.length]}" stroke="var(--surface)" stroke-width="2"><title>${superChartEscape(row.label)}: ${row.count}</title></path>`;
  }).join('');
  return `<div class="super-pie-chart" role="img" aria-label="${superChartEscape(label)}"><svg viewBox="0 0 140 140" aria-hidden="true">${slices}</svg><div class="chart-legend">${rows.map((r,i)=>`<div class="chart-legend-row"><i style="background:${colors[i%colors.length]}"></i><span>${superChartEscape(r.label)}</span><strong>${r.count}</strong></div>`).join('')}</div></div>`;
}
function superActivityHeatmap(entries){
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],counts=days.map(()=>Array(24).fill(0));
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',weekday:'short',hour:'2-digit',hourCycle:'h23'});
  entries.forEach(entry=>{const date=new Date(entry.ts);if(!Number.isFinite(+date))return;const parts=Object.fromEntries(format.formatToParts(date).map(p=>[p.type,p.value]));const day=days.indexOf(parts.weekday),hour=Number(parts.hour);if(day>=0&&hour<24)counts[day][hour]++;});
  const max=Math.max(1,...counts.flat()),colors=['var(--surface-2)','var(--super-heat-1)','var(--super-heat-2)','var(--super-heat-3)','var(--super-chart-1)'];
  const cells=counts.map((row,day)=>`<text x="32" y="${30+day*22}" text-anchor="end">${days[day]}</text>`+row.map((count,hour)=>`<rect x="${40+hour*17.5}" y="${16+day*22}" width="15.5" height="18" rx="2" fill="${count?colors[Math.max(1,Math.ceil(count/max*4))]:colors[0]}"><title>${days[day]} ${String(hour).padStart(2,'0')}:00 · ${count} events</title></rect>`).join('')).join('');
  const labels=[0,6,12,18,23].map(hour=>`<text x="${47+hour*17.5}" y="188" text-anchor="middle">${String(hour).padStart(2,'0')}:00</text>`).join('');
  return `<div class="super-heatmap"><svg viewBox="0 0 480 200" role="img" aria-label="Recorded activity by weekday and hour in Philippine time">${cells}${labels}</svg><div class="super-heatmap-key"><span>Less activity</span>${colors.map(color=>`<i style="background:${color}"></i>`).join('')}<span>More activity</span></div></div>`;
}

/* Comparisons use the same aggregate values in each chart form. */
function superComparisonChart(labels,series,type,label){
  const safe=superChartEscape,colors=['var(--super-chart-1)','var(--super-chart-2)','var(--super-chart-3)','var(--super-chart-4, #c24e78)','var(--super-chart-5, #b58ec6)','var(--super-chart-6, #94a3b8)'];
  series=series.map((item,index)=>({...item,color:item.color||colors[index%colors.length]}));
  const left=42,right=456,top=22,bottom=168;
  const max=Math.max(1,...labels.map((_,i)=>type==='stacked'?series.reduce((sum,s)=>sum+(s.values[i]||0),0):Math.max(...series.map(s=>s.values[i]||0))));
  const y=value=>bottom-value/max*(bottom-top),x=i=>left+(right-left)*i/Math.max(1,labels.length-1);
  const key='<div class="super-chart-key">'+series.map(s=>'<span><i style="background:'+s.color+'"></i>'+safe(s.label)+'</span>').join('')+'</div>';
  const grid=[...new Set([0,Math.round(max/2),max])].map(value=>{const f=value/max;return '<line x1="'+left+'" x2="'+right+'" y1="'+y(max*f)+'" y2="'+y(max*f)+'" stroke="var(--border)"/><text x="34" y="'+(y(max*f)+4)+'" text-anchor="end">'+value+'</text>';}).join('');
  const ticks=labels.map((name,i)=>i===labels.length-1||(i%Math.max(1,Math.ceil(labels.length/4))===0&&labels.length-1-i>1)?'<text x="'+x(i)+'" y="192" text-anchor="middle">'+safe(name)+'</text>':'').join('');
  let shapes='';
  if(type==='grouped'){
    const step=(right-left)/Math.max(1,labels.length),barWidth=Math.min(24,step/(series.length+1));
    shapes=labels.map((name,i)=>series.map((s,j)=>{const value=s.values[i]||0;return '<rect x="'+(left+step*(i+.5)+(j-series.length/2)*barWidth)+'" y="'+y(value)+'" width="'+Math.max(1,barWidth-2)+'" height="'+(bottom-y(value))+'" rx="2" fill="'+s.color+'"><title>'+safe(name)+' · '+safe(s.label)+': '+value+'</title></rect>';}).join('')+'<text x="'+(left+step*(i+.5))+'" y="192" text-anchor="middle">'+(labels.length<=7||i%4===0?safe(name):'')+'</text>').join('');
  }else if(type==='stacked'){
    const step=(right-left)/Math.max(1,labels.length);
    shapes=labels.map((name,i)=>{let base=0;return series.map((s,j)=>{const value=s.values[i]||0,h=value/max*(bottom-top),result='<rect x="'+(left+step*(i+.5)-18)+'" y="'+y(base+value)+'" width="36" height="'+h+'" rx="2" fill="'+s.color+'"><title>'+safe(name)+' � '+safe(s.label)+': '+value+'</title></rect>';base+=value;return result;}).join('')+'<text x="'+(left+step*(i+.5))+'" y="192" text-anchor="middle">'+safe(name)+'</text>';}).join('');
  }else{
    shapes=series.map((s,j)=>{
      const points=s.values.map((value,i)=>[x(i),y(value)]),path=points.map((p,i)=>{if(!i)return 'M'+p.join(' ');const prev=points[i-1],mid=(prev[0]+p[0])/2;return 'C'+mid+' '+prev[1]+' '+mid+' '+p[1]+' '+p.join(' ');}).join(' ');
      return (type==='area'?'<path d="'+path+' L'+x(labels.length-1)+' '+bottom+' L'+left+' '+bottom+' Z" fill="'+s.color+'" fill-opacity=".22"/>':'')+'<path d="'+path+'" fill="none" stroke="'+s.color+'" stroke-width="2"/>'+points.map((p,i)=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="'+s.color+'"><title>'+safe(labels[i])+' � '+safe(s.label)+': '+s.values[i]+'</title></circle>').join('');
    }).join('');
  }
  return '<div class="super-comparison-chart super-grouped-chart super-'+type+'-chart"><svg viewBox="0 0 480 205" role="img" aria-label="'+safe(label)+'">'+grid+shapes+(['stacked','grouped'].includes(type)?'':ticks)+'</svg>'+key+'</div>';
}
function superBubbleChart(rows,label){
  const max=Math.max(1,...rows.map(r=>r.count)),safe=superChartEscape;
  const dots=rows.map((r,i)=>{const x=58+r.days/14*350,y=156-r.count/max*112,color='var(--super-chart-'+(i%3+1)+')';return '<circle cx="'+x+'" cy="'+y+'" r="'+(5+Math.sqrt(r.count/max)*12)+'" fill="'+color+'" fill-opacity=".55" stroke="'+color+'"><title>'+safe(r.label)+': '+r.count+' events across '+r.days+' active days</title></circle>';}).join('');
  return '<div class="super-bubble-chart"><svg viewBox="0 0 480 205" role="img" aria-label="'+safe(label)+'"><path d="M40 18 V170 H450" fill="none" stroke="var(--border)"/><text x="40" y="12">Events (up to '+max+')</text>'+dots+'<text x="40" y="190">0 days</text><text x="450" y="190" text-anchor="end">14 active days</text></svg><div class="super-chart-key">'+rows.map((r,i)=>'<span><i style="background:var(--super-chart-'+(i%3+1)+')"></i>'+safe(r.label)+': '+r.count+' actions / '+r.days+' days</span>').join('')+'</div></div>';
}
function superOpposingBars(rows,label,groups=['Account changes','Access events']){
  const max=Math.max(1,...rows.flatMap(r=>[r.accounts,r.access])),safe=superChartEscape;
  const bars=rows.map((r,i)=>{const y=20+i*24,a=r.accounts/max*160,b=r.access/max*160;return '<g><title>'+safe(r.label)+': '+r.accounts+' '+safe(groups[0].toLowerCase())+'; '+r.access+' '+safe(groups[1].toLowerCase())+'</title><rect x="'+(240-a)+'" y="'+y+'" width="'+a+'" height="13" rx="2" fill="var(--super-chart-1)"/><rect x="240" y="'+y+'" width="'+b+'" height="13" rx="2" fill="var(--super-chart-3)"/><text x="'+(232-a)+'" y="'+(y+11)+'" text-anchor="end">'+r.accounts+'</text><text x="'+(248+b)+'" y="'+(y+11)+'">'+r.access+'</text><text x="8" y="'+(y+11)+'">'+safe(r.label)+'</text></g>';}).join('');
  return '<div class="super-opposing-chart"><svg viewBox="0 0 480 205" role="img" aria-label="'+safe(label)+'"><path d="M240 12 V190" stroke="var(--border)"/>'+bars+'</svg><div class="super-chart-key"><span><i style="background:var(--super-chart-1)"></i>'+safe(groups[0])+'</span><span><i style="background:var(--super-chart-3)"></i>'+safe(groups[1])+'</span></div></div>';
}
