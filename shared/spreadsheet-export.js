// Small, dependency-free XLSX writer. Values are text cells, never formulas.
(() => {
  const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const encode=value=>new TextEncoder().encode(value);
  function zip(files){
    const parts=[],directory=[];let offset=0,size=0;
    const header=(length)=>{const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};};
    const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
    for(const [name,text] of Object.entries(files)){
      const filename=encode(name),data=encode(text),checksum=crc(data),local=header(30),central=header(46);
      const a=local.view;a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(12,33,true);a.setUint32(14,checksum,true);a.setUint32(18,data.length,true);a.setUint32(22,data.length,true);a.setUint16(26,filename.length,true);
      parts.push(local.bytes,filename,data);
      const b=central.view;b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint16(14,33,true);b.setUint32(16,checksum,true);b.setUint32(20,data.length,true);b.setUint32(24,data.length,true);b.setUint16(28,filename.length,true);b.setUint32(42,offset,true);
      directory.push(central.bytes,filename);size+=46+filename.length;offset+=30+filename.length+data.length;
    }
    const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,Object.keys(files).length,true);end.view.setUint16(10,Object.keys(files).length,true);end.view.setUint32(12,size,true);end.view.setUint32(16,offset,true);
    const result=new Uint8Array(offset+size+22);let pos=0;for(const bytes of [...parts,...directory,end.bytes]){result.set(bytes,pos);pos+=bytes.length;}return result;
  }
  function workbook(rows,widths=[],options={}){
    const headingRows=new Set(options.headingRows||[0]);
    const sheetName=String(options.sheetName||'Audit Trail').replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'Report';
    const column=index=>{let label='';for(index++;index;index=Math.floor((index-1)/26))label=String.fromCharCode(65+(index-1)%26)+label;return label;};
    const count=Math.max(1,...rows.map(row=>row.length));
    const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({length:count},(_,i)=>`<col min="${i+1}" max="${i+1}" width="${widths[i]||24}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>`<c r="${column(j)}${i+1}" s="${headingRows.has(i)?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData>${options.filter===false?'':`<autoFilter ref="A1:${column(count-1)}${Math.max(1,rows.length)}"/>`}</worksheet>`;
    return zip({
      '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF252525"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF800000"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml':sheet,
    });
  }
  window.SpreadsheetExport={build:workbook,download(filename,rows,widths,options){const bytes=workbook(rows,widths,options),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}};
})();
