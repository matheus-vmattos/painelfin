/**
 * API Valoriza — versão enxuta
 * Módulos ativos: Auth, CRUD, Grupos, Rateio, Repasses, Rotina diária, Guias, Proprietários, Bootstrap
 * Removidos: Auditoria, Simulação de boletos, Devolução, Caixa Ronan, APA/INO, Conciliação, Checklist, Locatários
 */
const SHEET_ID = '15SgWtXswaxbZoGlGQNy4tuDPDHkYaKbuy9EbxSQeb-o';
const PREFIXO = {'Proprietários':'P','Imóveis':'IM','Fornecedores':'F','Guias':'GU'};

function doGet(e){return handle(e);}
function doPost(e){return handle(e);}
function handle(e){
  try{
    const p=e.parameter||{}, b=e.postData?JSON.parse(e.postData.contents||'{}'):{};
    const a=p.action||b.action, aba=p.aba||b.aba;
    if(a==='ping')           return json({ok:true,versao:'ENXUTA-1.0',protegido:temUsuarios()});
    if(a==='login')          return json(login(b.usuario||b.senha,b.senha));
    if(a==='registrar')      return json(registrar(b.usuario,b.senha));
    if(a==='trocaSenha')     return json(trocaSenhaSess(b.token||p.token,b.atual,b.nova));
    const tok=b.token||p.token;
    const sess=sessaoDe(tok);
    if(!sess)return json({erro:'nao_autorizado',precisaLogin:true});
    if(a==='eu')             return json({ok:true,usuario:sess.usuario,cargo:sess.cargo});
    if(a==='listarUsuarios') return json(exigeAdmin(sess,function(){return listarUsuarios();}));
    if(a==='aprovarUsuario') return json(exigeAdmin(sess,function(){return setCargo(b.usuario,b.cargo);}));
    if(a==='setCargo')       return json(exigeAdmin(sess,function(){return setCargo(b.usuario,b.cargo);}));
    if(a==='excluirUsuario') return json(exigeAdmin(sess,function(){return excluirUsuario(b.usuario,sess.usuario);}));
    if(!podeAcao(sess,a))return json({erro:'sem_permissao',cargo:sess.cargo,precisaPermissao:true});
    if(a==='initIDs')        return json(initIDs());
    if(a==='initGuias')      return json(initGuias());
    if(a==='listar')         return json(listar(aba));
    if(a==='salvar')         return json(salvar(aba,b.chaveCol,b.chave,b.dados));
    if(a==='adicionar')      return json(adicionar(aba,b.dados));
    if(a==='excluir')        return json(excluir(aba,b.id));
    if(a==='setGrupo')       return json(setGrupo(b.codigos,b.grupo));
    if(a==='addGrupo')       return json(addGrupo(b.grupo));
    if(a==='imoveisGrupo')   return json(imoveisGrupo(b.grupo));
    if(a==='duplicados')     return json(duplicados());
    if(a==='imoveisProp')    return json(imoveisProp(b.cpf));
    if(a==='transferir')     return json(transferir(b.id,b.proprietario,b.cpf));
    if(a==='historicoRateio')return json(historicoRateio(b.grupo));
    if(a==='limparGrupos')   return json(limparGrupos());
    if(a==='initRepasses')   return json(initRepasses());
    if(a==='listarRepasses') return json(listar('Repasses'));
    if(a==='addRepasse')     return json(addRepasse(b.dia,b.proprietario));
    if(a==='excluirRepasse') return json(excluir('Repasses',b.id));
    if(a==='lancarRateio')   return json(lancarRateio(b.linhas,b.divisores));
    if(a==='toggleCopiado')  return json(toggleCopiado(b.id,b.valor));
    if(a==='toggleCopiadoLote') return json(toggleCopiadoLote(b.ids,b.valor));
    if(a==='salvarLancamentoRateio')return json(salvarLancamentoRateio(b.id,b.dados));
    if(a==='excluirLancamentoRateio')return json(excluirLancamentoRateio(b.id));
    if(a==='resumoRateios')  return json(resumoRateios(b.competencia));
    if(a==='bootstrap')      return json(bootstrap(b.competencia));
    if(a==='finalizarRateio')return json(finalizarRateio(b.grupo,b.competencia));
    if(a==='reabrirRateio')  return json(reabrirRateio(b.grupo,b.competencia));
    if(a==='excluirRateioComp')return json(excluirRateioComp(b.grupo,b.competencia));
    if(a==='repararRateioStatus')return json(exigeAdmin(sess,function(){return repararRateioStatus();}));
    if(a==='divisoresGrupo') return json(divisoresGrupo(b.grupo));
    if(a==='duplicarCompetencia')return json(duplicarCompetencia(b.grupo,b.de,b.para));
    if(a==='rotinaDia')      return json(rotinaDia());
    if(a==='rotinaMarcar')   return json(rotinaMarcar(b.id,b.feito));
    if(a==='rotinaAdd')      return json(rotinaAdd(b.texto));
    if(a==='rotinaDel')      return json(rotinaDel(b.id));
    if(a==='rotinaMover')    return json(rotinaMover(b.id,b.dir));
    if(a==='rotinaResponder')return json(rotinaResponder(b.id,b.resposta));
    if(a==='setEmailLembrete')return json(exigeAdmin(sess,function(){return setEmailLembrete(b.email);}));
    if(a==='getEmailLembrete')return json({ok:true,email:_props().getProperty('EMAIL_LEMBRETE')||''});
    return json({ok:false,erro:'acao invalida'});
  }catch(err){return json({ok:false,erro:String(err)});}
}

/* ═══ CACHE POR REQUISIÇÃO ═══ */
var _SS=null;
function ss(){if(!_SS)_SS=SpreadsheetApp.openById(SHEET_ID);return _SS;}

var _OPT={hdr:{},data:{},sheetsObj:{}};

function _invalHdr(aba){
  delete _OPT.hdr[aba];
  delete _OPT.data[aba];
}
function sheet(a){
  if(_OPT.sheetsObj[a])return _OPT.sheetsObj[a];
  const s=ss().getSheetByName(a);
  if(!s)throw new Error('aba nao encontrada: '+a);
  _OPT.sheetsObj[a]=s;
  return s;
}
function _nc(s){
  var lc=s.getLastColumn();if(lc<1)return 0;
  var h=s.getRange(1,1,1,lc).getValues()[0];
  var n=0;for(var i=0;i<h.length;i++)if(String(h[i]).trim())n=i+1;
  return n;
}
function _ler(aba){
  var nome=typeof aba==='string'?aba:aba.getName();
  if(_OPT.data[nome])return _OPT.data[nome];
  var s=typeof aba==='string'?sheet(aba):aba;
  var nr=s.getLastRow(),nc=_nc(s);
  if(nr<1||nc<1)return [[]];
  var vals=s.getRange(1,1,nr,nc).getValues();
  _OPT.data[nome]=vals;
  return vals;
}
function _hdr(aba){
  if(!_OPT.hdr[aba]){
    var s=sheet(aba);var nc=Math.max(1,_nc(s));
    _OPT.hdr[aba]=s.getRange(1,1,1,nc).getValues()[0].map(function(x){return String(x).trim();});
  }
  return _OPT.hdr[aba];
}
function _writeRow(aba,row,dados){
  var h=_hdr(aba),s=sheet(aba),rng=s.getRange(row,1,1,h.length),vals=rng.getValues()[0];
  var mudou=false;
  h.forEach(function(k,c){if(dados.hasOwnProperty(k)){vals[c]=dados[k];mudou=true;}});
  if(mudou){rng.setValues([vals]);delete _OPT.data[aba];}
  return mudou;
}
function _batchRows(aba,updates){
  if(!updates.length)return 0;
  var h=_hdr(aba),s=sheet(aba);
  var rows=updates.map(function(u){return u.row;});
  var min=Math.min.apply(null,rows),max=Math.max.apply(null,rows);
  var rng=s.getRange(min,1,max-min+1,h.length),vals=rng.getValues();
  updates.forEach(function(u){
    var rel=u.row-min;
    h.forEach(function(k,c){if(u.dados.hasOwnProperty(k))vals[rel][c]=u.dados[k];});
  });
  rng.setValues(vals);
  delete _OPT.data[aba];
  return updates.length;
}

function json(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);}

/* ═══ GUIAS ═══ */
function _repararGuias(){
  try{
    var s=ss().getSheetByName('Guias');if(!s)return;
    var lc=Math.max(1,s.getLastColumn());
    var h=s.getRange(1,1,1,lc).getValues()[0].map(function(x){return String(x).trim();});
    if(h.indexOf('Mapa')<0){s.getRange(1,lc+1).setValue('Mapa');_invalHdr('Guias');SpreadsheetApp.flush();}
  }catch(e){}
}
function initGuias(){
  var s=ss().getSheetByName('Guias');
  if(!s){
    s=ss().insertSheet('Guias');
    s.appendRow(['ID','Título','Conteúdo','Mapa','Atualizado']);
    s.setFrozenRows(1);
    return {ok:true,criadas:['Guias']};
  }
  var h=s.getRange(1,1,1,Math.max(1,s.getLastColumn())).getValues()[0];
  if(h.indexOf('Mapa')<0){s.insertColumnAfter(h.length);s.getRange(1,h.length+1).setValue('Mapa');return {ok:true,criadas:['coluna Mapa']};}
  return {ok:true,criadas:['já existia']};
}

/* ═══ AUTENTICAÇÃO ═══ */
function _props(){return PropertiesService.getScriptProperties();}
function _sal(){var p=_props();if(!p.getProperty('SAL'))p.setProperty('SAL',Utilities.getUuid());return p.getProperty('SAL');}
function _hash(s){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,_sal()+String(s));
  return bytes.map(function(b){return ('0'+(b&0xFF).toString(16)).slice(-2);}).join('');
}
function _uNorm(u){return String(u||'').trim().toLowerCase();}
function usersSheet(){
  var s=ss().getSheetByName('Usuarios');
  if(!s){
    s=ss().insertSheet('Usuarios');
    s.appendRow(['Usuario','SenhaHash','Cargo','Token','TokenTS','Criado em']);
    s.setFrozenRows(1);
    var velho=_props().getProperty('SENHA_HASH');
    if(velho){s.appendRow(['admin',velho,'admin','','',Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy')]);}
  }
  return s;
}
function _uFind(u){
  u=_uNorm(u);
  var s=usersSheet(),v=s.getDataRange().getValues();
  for(var r=1;r<v.length;r++)if(_uNorm(v[r][0])===u)return {row:r+1,usuario:v[r][0],hash:v[r][1],cargo:String(v[r][2]||'').trim(),token:v[r][3],ts:Number(v[r][4]||0)};
  return null;
}
function temUsuarios(){
  var s=usersSheet(),v=s.getDataRange().getValues();
  for(var r=1;r<v.length;r++)if(String(v[r][2]||'').trim()==='admin')return true;
  return false;
}
function registrar(usuario,senha){
  usuario=_uNorm(usuario);
  if(!usuario||usuario.length<3)return {erro:'usuário precisa de ao menos 3 caracteres'};
  if(!senha||String(senha).length<4)return {erro:'senha precisa de ao menos 4 caracteres'};
  if(!/^[a-z0-9._-]+$/.test(usuario))return {erro:'use só letras, números, ponto, hífen ou underline'};
  var s=usersSheet();
  if(_uFind(usuario))return {erro:'este usuário já existe'};
  var primeiro=!temUsuarios();
  s.appendRow([usuario,_hash(senha),primeiro?'admin':'',' ',' ',Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy')]);
  return {ok:true,pendente:!primeiro,admin:primeiro,msg:primeiro?'Cadastrado como admin.':'Aguarde aprovação de um admin.'};
}
function login(usuario,senha){
  var u=_uFind(usuario);
  if(!u||_hash(senha)!==u.hash)return {erro:'usuário ou senha incorretos'};
  if(!u.cargo)return {erro:'cadastro ainda não aprovado',pendente:true};
  var tok=Utilities.getUuid();
  usersSheet().getRange(u.row,4,1,2).setValues([[tok,String(Date.now())]]);
  return {ok:true,token:tok,usuario:u.usuario,cargo:u.cargo};
}
function sessaoDe(tok){
  if(!tok||String(tok).trim().length<10)return null;
  var s=usersSheet(),v=s.getDataRange().getValues();
  for(var r=1;r<v.length;r++){
    if(String(v[r][3])===String(tok)){
      if(Date.now()-Number(v[r][4]||0)>1000*60*60*24*30)return null;
      var cargo=String(v[r][2]||'').trim();
      if(!cargo)return null;
      return {usuario:v[r][0],cargo:cargo,row:r+1};
    }
  }
  return null;
}
function exigeAdmin(sess,fn){if(sess.cargo!=='admin')return {erro:'apenas admin'};return fn();}
function podeAcao(sess,a){
  if(sess.cargo==='admin')return true;
  var escrita=/^(salvar|adicionar|excluir|setGrupo|addGrupo|transferir|lancarRateio|toggleCopiado|toggleCopiadoLote|finalizarRateio|reabrirRateio|excluirRateioComp|addRepasse|limparGrupos|initRepasses|initGuias|initIDs|rotina|setEmail)/;
  var exclusao=/^(excluir|excluirRateioComp|limpar|rotinaDel)/;
  if(sess.cargo==='leitor')return !escrita.test(a);
  if(sess.cargo==='assistencia')return !exclusao.test(a);
  return false;
}
function listarUsuarios(){
  var s=usersSheet(),v=s.getDataRange().getValues(),us=[];
  for(var r=1;r<v.length;r++)us.push({usuario:v[r][0],cargo:String(v[r][2]||'').trim(),pendente:!String(v[r][2]||'').trim(),criadoEm:v[r][5]||''});
  return {ok:true,usuarios:us};
}
function setCargo(usuario,cargo){
  cargo=String(cargo||'').trim();
  if(['admin','assistencia','leitor',''].indexOf(cargo)<0)return {erro:'cargo inválido'};
  var u=_uFind(usuario);if(!u)return {erro:'usuário não encontrado'};
  usersSheet().getRange(u.row,3).setValue(cargo);
  return {ok:true,usuario:u.usuario,cargo:cargo};
}
function excluirUsuario(usuario,quemPede){
  var u=_uFind(usuario);if(!u)return {erro:'usuário não encontrado'};
  if(_uNorm(usuario)===_uNorm(quemPede))return {erro:'você não pode excluir a si mesmo'};
  if(u.cargo==='admin'){
    var s=usersSheet(),v=s.getDataRange().getValues(),admins=0;
    for(var r=1;r<v.length;r++)if(String(v[r][2]||'').trim()==='admin')admins++;
    if(admins<=1)return {erro:'não dá para excluir o último admin'};
  }
  usersSheet().deleteRow(u.row);
  return {ok:true};
}
function trocaSenhaSess(tok,atual,nova){
  var sess=sessaoDe(tok);if(!sess)return {erro:'sessão inválida'};
  var u=_uFind(sess.usuario);
  if(_hash(atual)!==u.hash)return {erro:'senha atual incorreta'};
  if(!nova||String(nova).length<4)return {erro:'nova senha precisa de ao menos 4 caracteres'};
  var novoTok=Utilities.getUuid();
  usersSheet().getRange(u.row,2).setValue(_hash(nova));
  usersSheet().getRange(u.row,4,1,2).setValues([[novoTok,String(Date.now())]]);
  return {ok:true,token:novoTok};
}

/* ═══ CONFIG / IDs ═══ */
function cfgSheet(){
  var s=ss().getSheetByName('Config');
  if(!s){s=ss().insertSheet('Config');s.appendRow(['Chave','Valor']);}
  return s;
}
function cfgGet(chave){
  const s=cfgSheet(),v=s.getDataRange().getValues();
  for(var r=1;r<v.length;r++){if(String(v[r][0])===chave)return {row:r+1,val:Number(v[r][1])||0};}
  s.appendRow([chave,0]);return {row:s.getLastRow(),val:0};
}
function cfgSet(chave,val){const c=cfgGet(chave);cfgSheet().getRange(c.row,2).setValue(val);}
function nextID(pfx){
  var lock=LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const k='seq'+pfx,c=cfgGet(k),n=c.val+1;
    cfgSheet().getRange(c.row,2).setValue(n);
    SpreadsheetApp.flush();
    return pfx+'-'+('0000'+n).slice(-4);
  } finally {try{lock.releaseLock();}catch(e){}}
}
function initIDs(){
  const res={};
  Object.keys(PREFIXO).forEach(function(aba){
    const pfx=PREFIXO[aba],s0=ss().getSheetByName(aba);
    if(!s0){res[aba]='aba inexistente';return;}
    const s=s0,v=s.getDataRange().getValues(),h=v[0];
    var iID=h.indexOf('ID');
    if(iID<0){s.insertColumns(1);s.getRange(1,1).setValue('ID');iID=0;}
    const v2=s.getDataRange().getValues();
    var seq=0;
    for(var r=1;r<v2.length;r++){var cur=String(v2[r][iID]||'');var m=cur.match(/-(\d+)$/);if(m)seq=Math.max(seq,parseInt(m[1],10));}
    var count=0;
    for(var r=1;r<v2.length;r++){
      var vazio=v2[r].slice(iID+1).every(function(x){return x===''||x==null;});
      if(vazio)continue;
      if(!String(v2[r][iID]||'').trim()){seq++;s.getRange(r+1,iID+1).setValue(pfx+'-'+('0000'+seq).slice(-4));count++;}
    }
    cfgSet('seq'+pfx,seq);
    res[aba]={preenchidos:count,ultimo:seq};
  });
  return {ok:true,resultado:res};
}

/* ═══ CRUD ═══ */
function listar(aba){
  if(aba==='Guias')_repararGuias();
  const s=sheet(aba),v=_ler(s);
  if(v.length<2)return {ok:true,cabecalhos:v[0]||[],itens:[]};
  const h=v[0];
  var itens=[];
  for(var r=1;r<v.length;r++){
    var vazia=true;
    for(var c=0;c<v[r].length;c++){if(v[r][c]!==''&&v[r][c]!=null){vazia=false;break;}}
    if(vazia)continue;
    var o={_linha:r+1};h.forEach(function(k,c){if(String(k).trim())o[k]=v[r][c];});
    itens.push(o);
  }
  return {ok:true,cabecalhos:h,itens:itens};
}
function salvar(aba,chaveCol,chave,dados){
  const s=sheet(aba),v=_ler(s),h=v[0],idx=h.indexOf(chaveCol);
  if(idx<0)throw new Error('coluna chave inexistente: '+chaveCol);
  for(var r=1;r<v.length;r++){
    if(String(v[r][idx])===String(chave)){_writeRow(aba,r+1,dados);return {ok:true,linha:r+1};}
  }
  return {ok:false,erro:'chave nao encontrada'};
}
function adicionar(aba,dados){
  const s=sheet(aba),h=_hdr(aba);
  if(h.indexOf('ID')>=0&&!dados['ID']&&PREFIXO[aba])dados['ID']=nextID(PREFIXO[aba]);
  s.appendRow(h.map(function(k){return dados[k]!=null?dados[k]:'';}));
  delete _OPT.data[aba];
  return {ok:true,linha:s.getLastRow(),id:dados['ID']||''};
}
function excluir(aba,id){
  const s=sheet(aba),v=_ler(s),h=v[0],iID=h.indexOf('ID');
  if(iID<0)return {ok:false,erro:'sem coluna ID'};
  for(var r=1;r<v.length;r++){
    if(String(v[r][iID])===String(id)){
      s.deleteRow(r+1);
      delete _OPT.data[aba];
      return {ok:true};
    }
  }
  return {ok:false,erro:'id nao encontrado'};
}

/* ═══ GRUPOS / RATEIO ═══ */
function addGrupo(grupo){
  grupo=String(grupo||'').trim();if(!grupo)return {ok:false,erro:'grupo vazio'};
  if(/^\d{1,2}\s*[\/\-]\s*\d{4,5}$/.test(grupo))return {ok:false,erro:'nome invalido (parece competencia)'};
  const s=sheet('Grupos'),gn=s.getLastRow(),ex=gn<2?[]:s.getRange(2,1,gn-1,1).getValues().map(function(r){return String(r[0]).trim();});
  if(ex.indexOf(grupo)<0){s.appendRow([grupo]);delete _OPT.data['Grupos'];}
  return {ok:true,grupo:grupo};
}
function setGrupo(codigos,grupo){
  addGrupo(grupo);
  const s=sheet('Imóveis'),v=_ler(s),h=v[0],iCod=h.indexOf('Cód Imóvel');
  const set={};codigos.forEach(function(c){set[String(c)]=true;});
  var ups=[];for(var r=1;r<v.length;r++){if(set[String(v[r][iCod])])ups.push({row:r+1,dados:{'Grupo':grupo}});}
  _batchRows('Imóveis',ups);
  return {ok:true,atualizados:ups.length};
}
function imoveisGrupo(grupo){
  const s=sheet('Imóveis'),v=_ler(s),h=v[0];
  const iG=h.indexOf('Grupo'),iCod=h.indexOf('Cód Imóvel'),iEnd=h.indexOf('Endereço'),iSt=h.indexOf('Status'),iNC=h.indexOf('Não cobrar'),iID=h.indexOf('ID');
  const itens=[];
  for(var r=1;r<v.length;r++){
    if(String(v[r][iG]).trim()===String(grupo).trim()){
      itens.push({id:iID>=0?v[r][iID]:'',cod:v[r][iCod],endereco:v[r][iEnd],status:v[r][iSt],naoCobrar:!!String(v[r][iNC]).trim()});
    }
  }
  return {ok:true,grupo:grupo,itens:itens,total:itens.length};
}
function compKey(x){
  if(x instanceof Date){
    try{return Utilities.formatDate(x,ss().getSpreadsheetTimeZone()||'America/Sao_Paulo','MM/yyyy');}
    catch(e){var mm=('0'+(x.getMonth()+1)).slice(-2);return mm+'/'+x.getFullYear();}
  }
  var t=String(x==null?'':x).trim();
  var m=t.match(/^(\d{1,2})\s*[\/\-]\s*(\d{4})$/);
  if(m)return ('0'+m[1]).slice(-2)+'/'+m[2];
  var m2=t.match(/^(\d{4})\s*[\/\-]\s*(\d{1,2})$/);
  if(m2)return ('0'+m2[2]).slice(-2)+'/'+m2[1];
  return t;
}
function rsSheet(){
  var s=ss().getSheetByName('RateioStatus');
  if(!s){s=ss().insertSheet('RateioStatus');s.appendRow(['Grupo','Competência','Status','Finalizado em','Total']);s.getRange('B:B').setNumberFormat('@');}
  return s;
}
function rsLinhas(grupo,comp){
  var s=rsSheet(),v=_ler(s);
  comp=compKey(comp);
  var out=[];
  for(var r=1;r<v.length;r++){
    if(String(v[r][0]).trim()===String(grupo).trim()&&compKey(v[r][1])===comp)
      out.push({row:r+1,status:String(v[r][2]||'').trim()});
  }
  return out;
}
function rsGet(grupo,comp){var l=rsLinhas(grupo,comp);return l.length?l[l.length-1]:null;}
function repararRateioStatus(){
  var s=rsSheet(),v=_ler(s);
  var visto={},apagar=[];
  for(var r=v.length-1;r>=1;r--){
    var g=String(v[r][0]||'').trim();if(!g)continue;
    var k=g+'||'+compKey(v[r][1]);
    if(visto[k])apagar.push(r+1); else visto[k]=true;
  }
  apagar.sort(function(a,b){return b-a;});
  for(var i=0;i<apagar.length;i++)s.deleteRow(apagar[i]);
  delete _OPT.data['RateioStatus'];
  try{s.getRange('B:B').setNumberFormat('@');}catch(e){}
  return {ok:true,removidas:apagar.length,restantes:Object.keys(visto).length};
}
function rateioFinalizado(grupo,comp){var g=rsGet(grupo,comp);return !!(g&&g.status==='Finalizado');}
function finalizarRateio(grupo,comp){
  grupo=String(grupo||'').trim();comp=compKey(comp);
  if(!grupo||!comp)return {ok:false,erro:'grupo/competencia obrigatorios'};
  var res=resumoGrupoComp(grupo,comp);
  if(!res.lancamentos)return {ok:false,erro:'sem lancamentos para finalizar'};
  var s=rsSheet(),ls=rsLinhas(grupo,comp),agora=Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy HH:mm');
  if(ls.length){ls.forEach(function(g){s.getRange(g.row,3,1,3).setValues([['Finalizado',agora,res.total]]);});}
  else{s.appendRow([grupo,comp,'Finalizado',agora,res.total]);}
  delete _OPT.data['RateioStatus'];
  return {ok:true,grupo:grupo,competencia:comp,total:res.total};
}
function reabrirRateio(grupo,comp){
  var s=rsSheet(),ls=rsLinhas(grupo,comp);
  if(!ls.length)return {ok:false,erro:'sem registro para reabrir'};
  ls.forEach(function(g){s.getRange(g.row,3,1,2).setValues([['Em andamento','']]);});
  delete _OPT.data['RateioStatus'];
  return {ok:true,reabertas:ls.length};
}
function excluirRateioComp(grupo,comp){
  comp=compKey(comp);
  if(rateioFinalizado(grupo,comp))return {ok:false,erro:'rateio finalizado — reabra antes de excluir'};
  var s=sheet('Rateio'),v=_ler(s),h=v[0];
  var iG=h.indexOf('Grupo'),iC=h.indexOf('Competência');
  var apagar=[];
  for(var r=1;r<v.length;r++){
    if(String(v[r][iG]).trim()===String(grupo).trim()&&compKey(v[r][iC])===comp)apagar.push(r+1);
  }
  for(var i=apagar.length-1;i>=0;i--)s.deleteRow(apagar[i]);
  delete _OPT.data['Rateio'];
  return {ok:true,removidas:apagar.length};
}
function resumoGrupoComp(grupo,comp){
  var s=sheet('Rateio'),v=_ler(s),h=v[0];
  var iG=h.indexOf('Grupo'),iC=h.indexOf('Competência'),iV=h.indexOf('Valor'),iCod=h.indexOf('Cód Imóvel'),iCop=h.indexOf('Copiado');
  comp=compKey(comp);
  var n=0,total=0,ims={},copiados={};
  for(var r=1;r<v.length;r++){
    if(String(v[r][iG]).trim()!==String(grupo).trim()||compKey(v[r][iC])!==comp)continue;
    n++;total+=Number(v[r][iV])||0;
    var cod=String(v[r][iCod]);ims[cod]=true;
    if(String(v[r][iCop]).trim()==='Sim')copiados[cod]=true;
  }
  return {lancamentos:n,total:Math.round(total*100)/100,imoveis:Object.keys(ims).length,copiados:Object.keys(copiados).length};
}
function resumoRateios(comp){
  comp=compKey(comp);
  var s=sheet('Rateio'),v=_ler(s),h=v[0]||[];
  if(h.indexOf('Grupo')<0)return {ok:true,competencia:comp,grupos:{}};
  var iG=h.indexOf('Grupo'),iC=h.indexOf('Competência'),iV=h.indexOf('Valor'),iCod=h.indexOf('Cód Imóvel'),iCop=h.indexOf('Copiado');
  var by={};
  for(var r=1;r<v.length;r++){
    if(compKey(v[r][iC])!==comp)continue;
    var g=String(v[r][iG]).trim();if(!g)continue;
    var o=by[g]=by[g]||{lancamentos:0,total:0,ims:{},cop:{}};
    o.lancamentos++;o.total+=Number(v[r][iV])||0;
    var cod=String(v[r][iCod]);o.ims[cod]=true;
    if(String(v[r][iCop]).trim()==='Sim')o.cop[cod]=true;
  }
  var fs=_ler(rsSheet()),fin={};
  for(var r2=1;r2<fs.length;r2++){
    if(compKey(fs[r2][1])!==comp)continue;
    var gg=String(fs[r2][0]).trim();if(!gg)continue;
    var stt=String(fs[r2][2]||'').trim(),em=fs[r2][3]||'';
    if(!fin[gg])fin[gg]={status:stt,em:em};
    else if(stt==='Finalizado')fin[gg]={status:'Finalizado',em:em};
  }
  var grupos={};
  Object.keys(by).forEach(function(g){
    var o=by[g],f=fin[g];
    grupos[g]={lancamentos:o.lancamentos,total:Math.round(o.total*100)/100,imoveis:Object.keys(o.ims).length,
      copiados:Object.keys(o.cop).length,status:(f&&f.status==='Finalizado')?'Finalizado':'Em andamento',finalizadoEm:f?f.em:''};
  });
  Object.keys(fin).forEach(function(g){if(!grupos[g])grupos[g]={lancamentos:0,total:0,imoveis:0,copiados:0,status:fin[g].status,finalizadoEm:fin[g].em};});
  return {ok:true,competencia:comp,grupos:grupos};
}
function lancarRateio(linhas,divisores){
  if(!linhas||!linhas.length)return {ok:false,erro:'sem linhas'};
  linhas.forEach(function(d){d['Competência']=compKey(d['Competência']);});
  var comp=linhas[0]['Competência'],grupo=String(linhas[0]['Grupo']||'').trim();
  if(!/^\d{2}\/\d{4}$/.test(comp))return {ok:false,erro:'competencia invalida: '+comp};
  if(rateioFinalizado(grupo,comp))return {ok:false,erro:'rateio '+comp+' de '+grupo+' está FINALIZADO. Reabra para alterar.'};
  var lock=LockService.getScriptLock();
  try{lock.waitLock(20000);}catch(e){return {ok:false,erro:'ocupado, tente de novo'};}
  try{
    var s=sheet('Rateio'),v=_ler(s),h=v[0];
    var iID=h.indexOf('ID'),existentes={};
    for(var r=1;r<v.length;r++){var id=String(v[r][iID]||'').trim();if(id)existentes[id]=r+1;}
    var novas=[],ups=[];
    linhas.forEach(function(d){
      var id=String(d['ID']||'').trim();
      if(id&&existentes[id]){
        var dd={};h.forEach(function(k){if(k!=='Copiado'&&d.hasOwnProperty(k))dd[k]=d[k];});
        ups.push({row:existentes[id],dados:dd});
      } else {
        novas.push(h.map(function(k){return d[k]!=null?d[k]:'';}));
      }
    });
    var atualizadas=_batchRows('Rateio',ups);
    if(novas.length)s.getRange(s.getLastRow()+1,1,novas.length,h.length).setValues(novas);
    delete _OPT.data['Rateio'];
    if(divisores)_lembraDivisores(grupo,divisores); // 1 chamada em lote, em vez de 1 por serviço
    var ls=rsLinhas(grupo,comp);
    if(ls.length){ls.forEach(function(g){if(g.status!=='Finalizado')rsSheet().getRange(g.row,3).setValue('Em andamento');});}
    else rsSheet().appendRow([grupo,comp,'Em andamento','','']);
    delete _OPT.data['RateioStatus'];
    return {ok:true,inseridas:novas.length,atualizadas:atualizadas};
  } finally {try{lock.releaseLock();}catch(e){}}
}
function toggleCopiado(id,valor){
  const s=sheet('Rateio'),v=_ler(s),h=v[0],iId=h.indexOf('ID'),iC=h.indexOf('Copiado');
  for(var r=1;r<v.length;r++){
    if(String(v[r][iId])===String(id)){
      s.getRange(r+1,iC+1).setValue(valor?'Sim':'');
      delete _OPT.data['Rateio'];
      return {ok:true};
    }
  }
  return {ok:false,erro:'id nao encontrado'};
}
function toggleCopiadoLote(ids,valor){
  if(!ids||!ids.length)return {ok:false,erro:'sem ids'};
  const s=sheet('Rateio'),v=_ler(s),h=v[0],iId=h.indexOf('ID');
  const set={},achou={};ids.forEach(function(i){set[String(i)]=true;});
  var ups=[];
  for(var r=1;r<v.length;r++){var id=String(v[r][iId]);if(set[id]){ups.push({row:r+1,dados:{'Copiado':valor?'Sim':''}});achou[id]=true;}}
  _batchRows('Rateio',ups);
  var sumidos=ids.filter(function(i){return !achou[String(i)];});
  return {ok:true,marcadas:ups.length,naoAchados:sumidos.length,idsSumidos:sumidos.slice(0,5)};
}
function _divKey(grupo,serv){return 'DIV_'+String(grupo).trim()+'|'+String(serv).trim();}
function divisoresGrupo(grupo){
  var p=_props(),out={};
  ['Água','Luz','Manutenção','Gás','Outro'].forEach(function(s){
    var v=p.getProperty(_divKey(grupo,s));if(v)out[s]=Number(v)||'';
  });
  return {ok:true,grupo:grupo,divisores:out};
}
function _lembraDivisores(grupo,divisores){
  // grava todos os divisores do rateio numa única chamada ao PropertiesService
  // (antes: 1 chamada de rede por serviço informado — Água, Luz, Manutenção...)
  var pares={};
  for(var sv in divisores){
    if(!divisores.hasOwnProperty(sv))continue;
    var val=Number(divisores[sv]);
    if(val>0)pares[_divKey(grupo,sv)]=String(val);
  }
  if(Object.keys(pares).length)_props().setProperties(pares,false);
}
function duplicarCompetencia(grupo,de,para){
  grupo=String(grupo||'').trim();de=compKey(de);para=compKey(para);
  if(!grupo||!/^\d{2}\/\d{4}$/.test(de)||!/^\d{2}\/\d{4}$/.test(para))return {ok:false,erro:'parâmetros inválidos'};
  if(de===para)return {ok:false,erro:'competências iguais'};
  if(rateioFinalizado(grupo,para))return {ok:false,erro:'destino finalizado; reabra antes'};
  var s=sheet('Rateio'),v=_ler(s),h=v[0];
  var iG=h.indexOf('Grupo'),iC=h.indexOf('Competência'),iCod=h.indexOf('Cód Imóvel'),iCop=h.indexOf('Copiado');
  for(var r=1;r<v.length;r++){if(String(v[r][iG]).trim()===grupo&&compKey(v[r][iC])===para)return {ok:false,erro:'já há lançamentos em '+para+' para este grupo'};}
  var origem=[];
  for(var r2=1;r2<v.length;r2++){if(String(v[r2][iG]).trim()===grupo&&compKey(v[r2][iC])===de)origem.push(v[r2]);}
  if(!origem.length)return {ok:false,erro:'sem lançamentos em '+de+' para copiar'};
  var iCompl=h.indexOf('Complemento'),iServ=h.indexOf('Serviço');
  var novas=origem.map(function(row){
    var o=row.slice();
    o[iC]=para;
    o[0]=para+'|'+grupo+'|'+String(row[iCod])+'|'+String(row[iServ]);
    if(iCop>=0)o[iCop]='';
    if(iCompl>=0)o[iCompl]='CÓPIA de '+de+' (revisar)';
    return o;
  });
  s.getRange(s.getLastRow()+1,1,novas.length,h.length).setValues(novas);
  delete _OPT.data['Rateio'];
  var g=rsGet(grupo,para);
  if(!g)rsSheet().appendRow([grupo,para,'Em andamento','','']);
  delete _OPT.data['RateioStatus'];
  return {ok:true,copiadas:novas.length,de:de,para:para};
}
function salvarLancamentoRateio(id,dados){
  if(!id)return {ok:false,erro:'sem id'};
  var s=sheet('Rateio'),v=_ler(s),h=v[0],iId=h.indexOf('ID'),iG=h.indexOf('Grupo'),iC=h.indexOf('Competência');
  for(var r=1;r<v.length;r++){
    if(String(v[r][iId])!==String(id))continue;
    if(rateioFinalizado(v[r][iG],v[r][iC]))return {ok:false,erro:'rateio finalizado: reabra antes de editar'};
    var d={};
    if(dados&&dados.valor!=null)d['Valor']=Number(dados.valor)||0;
    if(dados&&dados.compl!=null)d['Complemento']=String(dados.compl);
    if(dados&&dados.serv!=null)d['Serviço']=String(dados.serv);
    _writeRow('Rateio',r+1,d);
    return {ok:true,linha:r+1};
  }
  return {ok:false,erro:'lançamento não encontrado'};
}
function excluirLancamentoRateio(id){
  if(!id)return {ok:false,erro:'sem id'};
  var s=sheet('Rateio'),v=_ler(s),h=v[0],iId=h.indexOf('ID'),iG=h.indexOf('Grupo'),iC=h.indexOf('Competência');
  var alvo=[];
  for(var r=1;r<v.length;r++){if(String(v[r][iId])===String(id))alvo.push({row:r+1,grupo:v[r][iG],comp:v[r][iC]});}
  if(!alvo.length)return {ok:false,erro:'lançamento não encontrado'};
  if(rateioFinalizado(alvo[0].grupo,alvo[0].comp))return {ok:false,erro:'rateio finalizado: reabra antes de excluir'};
  for(var i=alvo.length-1;i>=0;i--)s.deleteRow(alvo[i].row);
  delete _OPT.data['Rateio'];
  return {ok:true,removidas:alvo.length};
}

/* ═══ PROPRIETÁRIOS ═══ */
function imoveisProp(cpf){
  const s=sheet('Imóveis'),v=_ler(s),h=v[0];
  const iID=h.indexOf('ID'),iCod=h.indexOf('Cód Imóvel'),iEnd=h.indexOf('Endereço'),iCpf=h.indexOf('CPF Prop.'),iSt=h.indexOf('Status'),iGrp=h.indexOf('Grupo');
  const ims=[],grupos={};
  for(var r=1;r<v.length;r++){
    if(String(v[r][iCpf]).replace(/\D/g,'')===String(cpf).replace(/\D/g,'')){
      ims.push({id:v[r][iID],cod:v[r][iCod],endereco:v[r][iEnd],status:v[r][iSt],grupo:v[r][iGrp]});
      var g=String(v[r][iGrp]||'').trim();if(g)grupos[g]=(grupos[g]||0)+1;
    }
  }
  return {ok:true,imoveis:ims,grupos:Object.keys(grupos).map(function(g){return {grupo:g,qtd:grupos[g]};})};
}
function transferir(idImovel,novoProp,novoCpf){
  const s=sheet('Imóveis'),v=_ler(s),h=v[0],iID=h.indexOf('ID'),iP=h.indexOf('Proprietário'),iC=h.indexOf('CPF Prop.');
  for(var r=1;r<v.length;r++){
    if(String(v[r][iID])===String(idImovel)){
      s.getRange(r+1,iP+1).setValue(novoProp);
      if(iC>=0)s.getRange(r+1,iC+1).setValue(novoCpf||'');
      delete _OPT.data['Imóveis'];
      return {ok:true};
    }
  }
  return {ok:false,erro:'imovel nao encontrado'};
}
function historicoRateio(grupo){
  const s=sheet('Rateio'),v=_ler(s),h=v[0];
  if(v.length<2)return {ok:true,competencias:[],linhas:[]};
  const iG=h.indexOf('Grupo'),linhas=[];
  for(var r=1;r<v.length;r++){
    if(String(v[r][iG]).trim()===String(grupo).trim()){
      var o={};h.forEach(function(k,c){o[k]=(k==='Competência')?compKey(v[r][c]):v[r][c];});linhas.push(o);
    }
  }
  const comps=[];linhas.forEach(function(l){var c=String(l['Competência']||'');if(c&&comps.indexOf(c)<0)comps.push(c);});
  return {ok:true,competencias:comps,linhas:linhas};
}

/* ═══ GRUPOS / UTILITÁRIOS ═══ */
function limparGrupos(){
  var s=sheet('Grupos'),v=_ler(s),vistos={},apagar=[];
  for(var r=1;r<v.length;r++){
    var g=String(v[r][0]||'').trim();
    var lixo=!g||/^\d{1,2}\s*[\/\-]\s*\d{4,5}$/.test(g);
    if(lixo||vistos[g])apagar.push(r+1); else vistos[g]=true;
  }
  for(var i=apagar.length-1;i>=0;i--)s.deleteRow(apagar[i]);
  delete _OPT.data['Grupos'];
  return {ok:true,removidas:apagar.length};
}

/* ═══ REPASSES ═══ */
function initRepasses(){
  var s=ss().getSheetByName('Repasses')||ss().insertSheet('Repasses');
  var h=s.getRange(1,1,1,3).getValues()[0];
  if(String(h[0]).trim()!=='ID'){s.getRange(1,1,1,3).setValues([['ID','Dia','Proprietário']]);}
  return {ok:true};
}
function addRepasse(dia,prop){
  var s=sheet('Repasses'),h=s.getDataRange().getValues()[0];
  var d={'ID':nextID('R'),'Dia':dia,'Proprietário':prop};
  s.appendRow(h.map(function(k){return d[k]!=null?d[k]:'';}));
  delete _OPT.data['Repasses'];
  return {ok:true,id:d['ID']};
}

/* ═══ ROTINA DIÁRIA ═══ */
function rotinaSheet(){
  var s=ss().getSheetByName('RotinaDiaria');
  if(!s){
    s=ss().insertSheet('RotinaDiaria');
    s.appendRow(['ID','Ordem','Texto','FeitoEm','Pai','Tipo','Resposta']);
    s.setFrozenRows(1);
    var seed=[
      ['RD-1','Checar e-mail','chk',''],
      ['RD-2','Checar WhatsApp','chk',''],
      ['RD-3','Itaú conta 36 (locação): conferir extrato','chk',''],
      ['RD-4','Conta 36: teve pagamento atípico hoje? (sinistro, locatário que paga direto, APA/INO)','sn',''],
      ['RD-4a','Salvar comprovante para o arquivo','chk','RD-4'],
      ['RD-5','Itaú conta 37 (condomínios sem conta Sicoob): conferir extrato','chk',''],
      ['RD-6','Conta 37: teve pagamento atípico hoje?','sn',''],
      ['RD-6a','Salvar comprovante para o arquivo','chk','RD-6'],
      ['RD-6b','Imprimir para o setor de condomínios','chk','RD-6'],
      ['RD-7','Sicoob: conferir extrato','chk',''],
      ['RD-8','Sicoob: teve pagamento atípico hoje?','sn',''],
      ['RD-8a','Imprimir para o setor de condomínios','chk','RD-8'],
      ['RD-9','Conferir Advbox','chk',''],
      ['RD-10','Conferir os repasses','chk',''],
      ['RD-11','Conferir tickets','chk',''],
      ['RD-12','Fazer os pagamentos (conferir a conta atual)','chk','']
    ];
    seed.forEach(function(x,i){s.appendRow([x[0],i+1,x[1],'',x[3]||'',x[2],'']);});
    _props().setProperty('ROT_FMT','');
  }
  var h=s.getRange(1,1,1,s.getLastColumn()).getValues()[0].map(function(x){return String(x).trim();});
  var precisa=['ID','Ordem','Texto','FeitoEm','Pai','Tipo','Resposta'],mudou=false;
  precisa.forEach(function(col){if(h.indexOf(col)<0){s.getRange(1,s.getLastColumn()+1).setValue(col);h.push(col);mudou=true;}});
  if(mudou){SpreadsheetApp.flush();}
  if(_props().getProperty('ROT_FMT')!=='1'){
    var hf=s.getRange(1,1,1,s.getLastColumn()).getValues()[0];
    var idxF=hf.indexOf('FeitoEm'),idxR=hf.indexOf('Resposta');
    var nr=Math.max(1,s.getLastRow());
    if(idxF>=0)s.getRange(1,idxF+1,nr,1).setNumberFormat('@');
    if(idxR>=0)s.getRange(1,idxR+1,nr,1).setNumberFormat('@');
    _props().setProperty('ROT_FMT','1');
  }
  return s;
}
function _hojeStr(){return Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy');}
function _dataStr(x){
  if(!x)return '';
  if(x instanceof Date)return Utilities.formatDate(x,'America/Sao_Paulo','dd/MM/yyyy');
  return String(x).trim();
}
function _respHoje(v,hoje){
  var s=String(v||'');var i=s.indexOf('|');if(i<0)return '';
  return s.slice(0,i)===hoje?s.slice(i+1):'';
}
function rotinaDia(){
  var s=rotinaSheet(),v=s.getDataRange().getValues(),h=v[0];
  var iId=h.indexOf('ID'),iOr=h.indexOf('Ordem'),iTx=h.indexOf('Texto'),iF=h.indexOf('FeitoEm'),
      iPai=h.indexOf('Pai'),iTp=h.indexOf('Tipo'),iRe=h.indexOf('Resposta');
  var hoje=_hojeStr(),brutos=[];
  for(var r=1;r<v.length;r++){
    if(!String(v[r][iTx]||'').trim())continue;
    var tipo=iTp>=0?(String(v[r][iTp]||'').trim()||'chk'):'chk';
    var pai=iPai>=0?String(v[r][iPai]||'').trim():'';
    var o={id:String(v[r][iId]),ordem:Number(v[r][iOr])||r,texto:v[r][iTx],tipo:tipo,pai:pai};
    if(tipo==='sn'){o.resposta=_respHoje(v[r][iRe],hoje);}
    else{o.feito=_dataStr(v[r][iF])===hoje;}
    brutos.push(o);
  }
  brutos.sort(function(a,b){return a.ordem-b.ordem;});
  var porId={};brutos.forEach(function(o){porId[o.id]=o;});
  var topo=[];
  brutos.forEach(function(o){
    if(o.pai&&porId[o.pai]){var p=porId[o.pai];p.filhos=p.filhos||[];p.filhos.push(o);}
    else topo.push(o);
  });
  var feitos=0,total=0;
  topo.forEach(function(o){
    if(o.tipo==='sn'){
      total++;
      if(o.resposta==='Não'){feitos++;o.concluido=true;}
      else if(o.resposta==='Sim'){
        var fs=o.filhos||[];
        total+=fs.length;feitos+=fs.filter(function(f){return f.feito;}).length;
        o.concluido=fs.length>0&&fs.every(function(f){return f.feito;});
      } else{o.concluido=false;}
    } else{total++;if(o.feito)feitos++;o.concluido=o.feito;}
  });
  return {ok:true,itens:topo,feitos:feitos,total:total};
}
function _rotFind(s,id){
  var v=s.getDataRange().getValues(),h=v[0],iId=h.indexOf('ID');
  for(var r=1;r<v.length;r++)if(String(v[r][iId])===String(id))return {row:r+1,h:h};
  return null;
}
function rotinaMarcar(id,feito){
  var s=rotinaSheet(),f=_rotFind(s,id);if(!f)return {erro:'item nao encontrado: '+id};
  var iTp=f.h.indexOf('Tipo');
  var tipo=iTp>=0?String(s.getRange(f.row,iTp+1).getValue()||'').trim():'chk';
  if(tipo==='sn')return {erro:'este item é uma pergunta sim/não; use rotinaResponder'};
  var iF=f.h.indexOf('FeitoEm');
  if(iF<0)return {erro:'coluna FeitoEm ausente'};
  s.getRange(f.row,iF+1).setValue(feito?_hojeStr():'');
  return {ok:true,gravado:feito?_hojeStr():''};
}
function rotinaResponder(id,resposta){
  resposta=String(resposta||'').trim();
  if(resposta!=='Sim'&&resposta!=='Não')return {erro:'resposta deve ser Sim ou Não'};
  var s=rotinaSheet(),f=_rotFind(s,id);if(!f)return {erro:'item nao encontrado: '+id};
  var iTp=f.h.indexOf('Tipo'),iRe=f.h.indexOf('Resposta');
  var tipo=iTp>=0?String(s.getRange(f.row,iTp+1).getValue()||'').trim():'';
  if(tipo!=='sn')return {erro:'este item não é uma pergunta sim/não'};
  if(iRe<0)return {erro:'coluna Resposta ausente'};
  s.getRange(f.row,iRe+1).setValue(_hojeStr()+'|'+resposta);
  return {ok:true,resposta:resposta};
}
function rotinaAdd(texto){
  texto=String(texto||'').trim();if(!texto)return {erro:'texto vazio'};
  var s=rotinaSheet(),v=s.getDataRange().getValues();
  var maxOrd=0;for(var r=1;r<v.length;r++)maxOrd=Math.max(maxOrd,Number(v[r][1])||0);
  s.appendRow(['RD-'+Utilities.getUuid().slice(0,6),maxOrd+1,texto,'']);
  return {ok:true};
}
function rotinaDel(id){
  var s=rotinaSheet(),f=_rotFind(s,id);if(!f)return {erro:'nao encontrado'};
  var v=s.getDataRange().getValues(),h=v[0],iId=h.indexOf('ID'),iPai=h.indexOf('Pai');
  var linhas=[f.row];
  if(iPai>=0){for(var r=1;r<v.length;r++){if(String(v[r][iPai]||'').trim()===String(id))linhas.push(r+1);}}
  linhas.sort(function(a,b){return b-a;});
  linhas.forEach(function(row){s.deleteRow(row);});
  return {ok:true,removidas:linhas.length};
}
function rotinaMover(id,dir){
  var s=rotinaSheet(),v=s.getDataRange().getValues(),h=v[0],iId=h.indexOf('ID'),iOr=h.indexOf('Ordem');
  var lin=[];for(var r=1;r<v.length;r++)lin.push({row:r+1,id:v[r][iId],ord:Number(v[r][iOr])||r});
  lin.sort(function(a,b){return a.ord-b.ord;});
  var i=-1;for(var k=0;k<lin.length;k++)if(String(lin[k].id)===String(id))i=k;
  if(i<0)return {erro:'nao encontrado'};
  var j=i+(dir<0?-1:1);if(j<0||j>=lin.length)return {ok:true};
  s.getRange(lin[i].row,iOr+1).setValue(lin[j].ord);
  s.getRange(lin[j].row,iOr+1).setValue(lin[i].ord);
  return {ok:true};
}

/* ═══ E-MAIL (config apenas, sem envio — Checklist removido) ═══ */
function setEmailLembrete(email){
  if(email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return {erro:'e-mail inválido'};
  _props().setProperty('EMAIL_LEMBRETE',email||'');
  return {ok:true,email:email||''};
}

/* ═══ BOOTSTRAP ═══ */
function bootstrap(competencia){
  var out={ok:true};
  try{out.imoveis=listar('Imóveis').itens;}catch(e){out.imoveis=[];}
  try{
    var gs_=sheet('Grupos');var gn=gs_.getLastRow();
    out.grupos=gn<2?[]:gs_.getRange(2,1,gn-1,1).getValues().map(function(r){return String(r[0]).trim();}).filter(Boolean);
  }catch(e){out.grupos=[];}
  try{out.repasses=listar('Repasses').itens;}catch(e){out.repasses=[];}
  try{out.proprietarios=listar('Proprietários').itens;}catch(e){out.proprietarios=[];}
  try{out.fornecedores=listar('Fornecedores').itens;}catch(e){out.fornecedores=[];}
  if(competencia){try{out.rateios=resumoRateios(competencia).grupos;}catch(e){out.rateios={};}}
  return out;
}

/* ═══ DUPLICADOS (sem Locatários) ═══ */
function nrm(s){return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
function duplicados(){
  const out={proprietarios:[],imoveis:[]};
  (function(){
    const s=sheet('Proprietários'),v=_ler(s),h=v[0];
    const iID=h.indexOf('ID'),iN=h.indexOf('Proprietário'),iC=h.indexOf('CPF');const m={};
    for(var r=1;r<v.length;r++){var k=nrm(v[r][iC]);if(!k)continue;(m[k]=m[k]||[]).push({id:v[r][iID],nome:v[r][iN],cpf:v[r][iC]});}
    for(var k in m)if(m[k].length>1)out.proprietarios.push(m[k]);
  })();
  (function(){
    const s=sheet('Imóveis'),v=_ler(s),h=v[0];
    const iID=h.indexOf('ID'),iE=h.indexOf('Endereço'),iP=h.indexOf('Proprietário'),iCod=h.indexOf('Cód Imóvel');const m={};
    for(var r=1;r<v.length;r++){var k=nrm(v[r][iE]);if(!k)continue;(m[k]=m[k]||[]).push({id:v[r][iID],cod:v[r][iCod],endereco:v[r][iE],prop:v[r][iP]});}
    for(var k in m)if(m[k].length>1)out.imoveis.push(m[k]);
  })();
  return {ok:true,dup:out};
}
