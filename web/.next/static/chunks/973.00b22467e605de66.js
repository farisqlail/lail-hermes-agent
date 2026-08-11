"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[973],{1973:function(e,t,i){let r;i.r(t),i.d(t,{WebGPUBackend:function(){return K},webgpu_util:function(){return f}});var a,s,o,n,u,l,d,h,p,c,f={};i.r(f),i.d(f,{GPUBytesPerElement:function(){return V},MatMulProgramType:function(){return d},assertNotComplex:function(){return G},computeDispatch:function(){return E},computeWorkPerThreadForConv2d:function(){return O},computeWorkgroupInfoForMatMul:function(){return B},computeWorkgroupSizeForConv2d:function(){return W},flatDispatchLayout:function(){return U},isWebGPUSupported:function(){return M},tilesFitEvenlyIntoShape:function(){return L}});var m=i(46040);let g=(0,m.env)();g.registerFlag("WEBGPU_DEFERRED_SUBMIT_BATCH_SIZE",()=>15),g.registerFlag("WEBGPU_CPU_FORWARD",()=>!0),g.registerFlag("WEBGPU_MATMUL_PROGRAM_TYPE",()=>-1),g.registerFlag("WEBGPU_USE_NAIVE_CONV2D_TRANSPOSE",()=>!0),g.registerFlag("WEBGPU_USE_LOW_POWER_GPU",()=>!1),g.registerFlag("WEBGPU_CPU_HANDOFF_SIZE_THRESHOLD",()=>1e3),g.registerFlag("WEBGPU_USE_PROFILE_TOOL",()=>!1),g.registerFlag("WEBGPU_IMPORT_EXTERNAL_TEXTURE",()=>!0),g.registerFlag("WEBGPU_USE_NAIVE_CONV2D_DEBUG",()=>!1),g.registerFlag("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL",()=>-1),g.registerFlag("WEBGPU_CONV_SEPARATE_IM2COL_SHADER",()=>!1),g.registerFlag("WEBGPU_PRINT_SHADER",()=>""),g.registerFlag("WEBGPU_ENGINE_COMPILE_ONLY",()=>!1);class x{constructor(e){e&&(this.vendor=e.vendor,this.architecture=e.architecture,this.intelGPUGeneration=this.getIntelGPUGeneration())}getIntelGPUGeneration(){if(this.isIntel()){if(this.architecture.startsWith("gen"))return Number(this.architecture.match(/\d+/));if(this.architecture.startsWith("xe"))return 12}return 0}isIntel(){return"intel"===this.vendor}}class y{constructor(e){this.device=e,this.numUsedBuffers=0,this.numFreeBuffers=0,this.freeBuffers=new Map,this.usedBuffers=new Map,this.numBytesUsed=0,this.numBytesAllocated=0}acquireBuffer(e,t,i=!1,r=!0){let a;let s=`${e}_${t}`;return r?(this.freeBuffers.has(s)||this.freeBuffers.set(s,[]),this.freeBuffers.get(s).length>0?(a=this.freeBuffers.get(s).pop(),this.numFreeBuffers--):(a=this.device.createBuffer({size:e,usage:t,mappedAtCreation:i}),this.numBytesAllocated+=e)):(a=this.device.createBuffer({size:e,usage:t,mappedAtCreation:i}),this.numBytesAllocated+=e),this.usedBuffers.has(s)||this.usedBuffers.set(s,[]),this.usedBuffers.get(s).push(a),this.numUsedBuffers++,this.numBytesUsed+=e,a}releaseBuffer(e,t=!0){var i;if(0===this.freeBuffers.size)return;let r=e.size,a=(i=e.usage,`${r}_${i}`),s=this.usedBuffers.get(a),o=s.indexOf(e);if(o<0)throw Error("Cannot find the buffer in buffer manager");s[o]=s[s.length-1],s.pop(),this.numUsedBuffers--,this.numBytesUsed-=r,t?(this.freeBuffers.get(a).push(e),this.numFreeBuffers++):(e.destroy(),this.numBytesAllocated-=r)}getNumUsedBuffers(){return this.numUsedBuffers}getNumFreeBuffers(){return this.numFreeBuffers}dispose(){this.freeBuffers.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.usedBuffers.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.freeBuffers=new Map,this.usedBuffers=new Map,this.numUsedBuffers=0,this.numFreeBuffers=0,this.numBytesUsed=0,this.numBytesAllocated=0}}class w{constructor(e){this.device=e,this.numUsedTextures=0,this.numFreeTextures=0,this.freeTextures=new Map,this.usedTextures=new Map,this.numBytesUsed=0,this.numBytesAllocated=0}acquireTexture(e,t,i,r){let a=e*t*C(i),s=b(e,t,i,r);if(this.freeTextures.has(s)||this.freeTextures.set(s,[]),this.usedTextures.has(s)||this.usedTextures.set(s,[]),this.numBytesUsed+=a,this.numUsedTextures++,this.freeTextures.get(s).length>0){this.numFreeTextures--;let e=this.freeTextures.get(s).shift();return this.usedTextures.get(s).push(e),e}this.numBytesAllocated+=a;let o=this.device.createTexture({size:[e,t],format:i,usage:r});return this.usedTextures.get(s).push(o),o}releaseTexture(e){if(0===this.freeTextures.size)return;let t=e.width,i=e.height,r=e.format,a=b(t,i,r,e.usage);this.freeTextures.has(a)||this.freeTextures.set(a,[]),this.freeTextures.get(a).push(e),this.numFreeTextures++,this.numUsedTextures--;let s=this.usedTextures.get(a),o=s.indexOf(e);if(o<0)throw Error("Cannot release a texture that was never provided by this texture manager");s.splice(o,1);let n=t*i*C(r);this.numBytesUsed-=n}getNumUsedTextures(){return this.numUsedTextures}getNumFreeTextures(){return this.numFreeTextures}dispose(){this.freeTextures.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.usedTextures.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.freeTextures=new Map,this.usedTextures=new Map,this.numUsedTextures=0,this.numFreeTextures=0,this.numBytesUsed=0,this.numBytesAllocated=0}}function b(e,t,i,r){return`${e}_${t}_${i}_${r}`}function C(e){if("rgba8unorm"===e)return 16;throw Error(`${e} is not supported!`)}let S=(e,t,i)=>"int32"===i?`atomicAdd(${e}, bitcast<i32>(${t}));`:`
          {
            var oldValue = 0;
            loop {
              let newValueF32 = bitcast<f32>(oldValue) + (${t});
              let newValue = bitcast<i32>(newValueF32);
              let res = atomicCompareExchangeWeak(${e}, oldValue, newValue);
              if res.exchanged {
                break;
              }
              oldValue = res.old_value;
            }
          }`;(a=l||(l={}))[a.FROM_PIXELS=0]="FROM_PIXELS",a[a.DRAW=1]="DRAW";let v=(e,t,i,r,a)=>{let s=function(e,t,i){var r;let a;let s=[],o=i.workgroupSize[0]*i.workgroupSize[1]*i.workgroupSize[2];if(i.outputComponent=i.outputComponent?i.outputComponent:1,s.push(`

      var<private> localId: vec3<u32>;
      var<private> localIndex: u32;
      var<private> globalId: vec3<u32>;
      var<private> numWorkgroups: vec3<u32>;
      var<private> workgroupId: vec3<u32>;

      // Only used when the y/z dimension of workgroup size is 1.
      fn getGlobalIndex() -> i32 {
        ${D(i)?"  return i32(globalId.x);":`  return i32((workgroupId.z * numWorkgroups.x * numWorkgroups.y +
                workgroupId.y * numWorkgroups.x + workgroupId.x) * ${o}u +
                localIndex);
        `}
      }
    `),null!=i.pixelsOpType){let r=i.pixelsOpType===l.FROM_PIXELS?`@group(0) @binding(0) var<storage, read_write> result: array<${F(t.dtype,i.outputComponent)}>;`:`@group(0) @binding(1) var<storage, read> inBuf : array<${F(e[0].dtype,i.outputComponent)}>;`,a=3===t.shape.length?"vec2<i32>":"i32";s.push(`
        struct Uniform {
          outShapeStrides : ${a},
          size            : i32,
          numChannels     : i32,
          alpha           : f32,
        };

        ${r}
        @group(0) @binding(2) var<uniform> uniforms: Uniform;
      `);let o=_(i);return[z,s.join("\n"),A(t.shape),i.getUserCode(),P(o,i)].join("\n")}let n="struct Uniforms { NAN : f32, INFINITY : f32, ";i.variableNames.forEach((t,i)=>{let r=k(e[i].shape.length);n+=`${t.charAt(0).toLowerCase()+t.slice(1)}Shape : ${r}, `,a=k(e[i].shape.length-1),n+=`${t.charAt(0).toLowerCase()+t.slice(1)}ShapeStrides: ${a}, `});let u=k(t.shape.length);n+=`outShape : ${u}, `,a=k(t.shape.length-1),n+=`
         outShapeStrides: ${a}, `,i.size&&(n+="size : i32, "),i.uniforms&&(n+=i.uniforms),n+="};",n=n.replace(/(\w+)\s*:\s*vec(5|6)/g,e=>"@align(16) "+e).replace(/vec(5|6)\s*,\s*(\w+)/g,(e,t,i)=>`vec${t}, @align(16) ${i}`),s.push(n),i.atomic?s.push(`
      @group(0) @binding(0) var<storage, read_write> result: array<atomic<i32>>;
    `):s.push(`
      @group(0) @binding(0) var<storage, read_write> result: array<${F(t.dtype,i.outputComponent)}>;
    `),i.variableNames.forEach((t,r)=>{s.push(`
      @group(0) @binding(${1+r}) var<storage, read> ${t}: array<${i.variableComponents?F(e[r].dtype,i.variableComponents[r]):F(e[r].dtype,i.outputComponent)}>;
        `)}),""!==n&&s.push(`
      @group(0) @binding(${1+i.variableNames.length}) var<uniform> uniforms: Uniforms;
      `);let d=function(e,t){let{x:i,y:r=[],z:a=[]}=t,s=e.length,o=i.length+r.length+a.length;if(o!==s)return"";if(i.length===s){let e=k(s);return`fn getOutputCoords() -> ${e}{
    let globalIndex = getGlobalIndex();
    return getCoordsFromIndex(globalIndex);
  }
  `}let n="",u=[i,r,a];for(let e=0;e<u.length;e++){let t=u[e];if(0!==t.length){if(1===t.length)n+=`let d${t[0]} = i32(globalId[${e}]);`;else{let i=function(e,t){if(Math.max(...e)>5)throw Error("Cannot symbolically compute strides for rank > 6 tensor.");let i=e.length,r=e.map(e=>`${t}.${"xyzwuv"[e]}`),a=Array(i-1);a[i-2]=r[i-1];for(let e=i-3;e>=0;--e)a[e]=`(${a[e+1]} * ${r[e+1]})`;return a}(t,"uniforms.outShape");n+=`var index${e} = i32(globalId[${e}]);`;for(let r=0;r<i.length;r++)n+=`let d${t[r]} = index${e} / ${i[r]};`,r===i.length-1?n+=`let d${t[r+1]} = index${e} - d${t[r]} * ${i[r]};`:n+=`index${e} = index${e} - d${t[r]} * ${i[r]};`}}}let l=[];for(let e=0;e<o;e++)l.push(`d${e}`);let d=k(o),h=`fn getOutputCoords() -> ${d} {
  ${n}
`;return 0===l.length?h+=`return ${d}(0); }`:h+=`return ${d}(${l.join(",")}); }`,h}(t.shape,i.dispatchLayout),h=[z,s.join("\n")+N,A(t.shape),d,function(e){let t="";switch(e){case 0:case 1:t+=`
        fn getOutputIndexFromCoords(coords : i32) -> i32 {
          return coords;
        }
        `;break;case 2:t+=`
        fn getOutputIndexFromCoords(coords : vec2<i32>) -> i32 {
          return dot(coords, vec2<i32>(uniforms.outShapeStrides, 1));
        }
        `;break;case 3:t+=`
        fn getOutputIndexFromCoords(coords : vec3<i32>) -> i32 {
          return dot(coords, vec3<i32>(uniforms.outShapeStrides.x, uniforms.outShapeStrides.y, 1));
        }
        `;break;case 4:t+=`
        fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
          return dot(coords, vec4<i32>(
            uniforms.outShapeStrides.x, uniforms.outShapeStrides.y, uniforms.outShapeStrides.z, 1));
        }
        `;break;case 5:t+=`
        fn getOutputIndexFromCoords(coords : vec5) -> i32 {
          return coords.x * uniforms.outShapeStrides.x +
              coords.y * uniforms.outShapeStrides.y +
              coords.z * uniforms.outShapeStrides.z +
              coords.w * uniforms.outShapeStrides.w +
              coords.u;
        }
        `;break;case 6:t+=`
        fn getOutputIndexFromCoords(coords : vec6) -> i32 {
          return coords.x * uniforms.outShapeStrides.x +
              coords.y * uniforms.outShapeStrides.y +
              coords.z * uniforms.outShapeStrides.z +
              coords.w * uniforms.outShapeStrides.w +
              coords.u * uniforms.outShapeStrides.u +
              coords.v;
        }
        `;break;default:m.util.assert(!1,()=>`Unsupported ${e}D shape`)}return t}(t.shape.length)];i.atomic||h.push(function(e,t,i){let r=e.length,a=F(t,i),s=`fn setOutputAtIndex(flatIndex : i32, value : ${I(i)}) {
      result[flatIndex] = ${a}(value);
    }

    fn setOutputAtIndexI32(flatIndex : i32, value : ${I(i,"i32")}) {
      result[flatIndex] = ${a}(value);
    }
    `;if(r>=2){let e=["d0","d1","d2","d3","d4","d5"].slice(0,r),t=k(r);s+=`
      fn setOutputAtCoords(${e.map(e=>`${e} : i32`).join(", ")}, value : ${I(i)}) {
        let flatIndex = getOutputIndexFromCoords(${t}(${e.join(", ")}));
        setOutputAtIndex(flatIndex${1===i?"":` / ${i}`}, value);
      }
      fn setOutputAtCoordsI32(${e.map(e=>`${e} : i32`).join(", ")}, value : ${I(i,"i32")}) {
        let flatIndex = getOutputIndexFromCoords(${t}(${e.join(", ")}));
        setOutputAtIndexI32(flatIndex${1===i?"":` / ${i}`}, value);
      }
    `}return s}(t.shape,t.dtype,i.outputComponent)),i.variableNames.forEach((t,i)=>{h.push(`${A(e[i].shape,t)}`)});let p=e.map((e,r)=>{var a,s,o;let n;return a=t.shape,s=i.variableComponents?i.variableComponents[r]:i.outputComponent,o=i.dispatchLayout.x.length===t.shape.length,n=function(e,t){let i=e.name,r=e.shape.length,a=k(r),s="get"+i.charAt(0).toUpperCase()+i.slice(1),o=["d0","d1","d2","d3","d4","d5"].slice(0,r),n=o.map(e=>`${e} : i32`).join(", ");if(r<1)return`
      fn ${s}() -> ${I(t)} {
        return ${I(t)}(${i}[0]);
      }
    `;let u=`uniforms.${i.charAt(0).toLowerCase()+i.slice(1)}Shape`,l=`${r}D`;return 0===r&&(l="1D"),`
    fn ${s}(${n}) -> ${I(t)} {
      return ${I(t)}(${i}[getIndexFromCoords${l}(${a}(${o.join(",")}),
        ${u})${1===t?"":` / ${t}`}]);
    }
   `}(e,s),e.shape.length<=a.length&&(n+=function(e,t,i,r){let a=e.name,s=a.charAt(0).toUpperCase()+a.slice(1),o="get"+s+"ByOutput",n=e.shape.length,u=t.length,l=k(u);if(m.util.arraysEqual(e.shape,t)&&r)return`
    fn ${o}Index(globalIndex : i32) -> ${I(i)} {
      return ${I(i)}(${a}[globalIndex]);
    }

    fn ${o}Coords(coords : ${l}) -> ${I(i)} {
      return ${I(i)}(${a}[${u>1?"getOutputIndexFromCoords(coords)":"coords"}${1===i?"":` / ${i}`}]);
    }
    `;let d=m.backend_util.getBroadcastDims(e.shape,t),h=u-n,p="";if(0===n)return`
    fn ${o}Index(globalIndex : i32) -> ${I(i)}{
      return get${s}();
    }

    fn ${o}Coords(coords : ${l}) -> ${I(i)}{
      return get${s}();
    }
  `;p=u<2&&d.length>=1?"coords = 0;":d.map(e=>`coords.${R(e+h)} = 0;`).join("\n");let c="";if(u<2&&n>0)c="coords";else if(u>1){let t=k(n),i=e.shape.map((e,t)=>`coords.${R(t+h)}`).join(", ");c=`${t}(${i})`}else c="coords";let f=`uniforms.${a.charAt(0).toLowerCase()+a.slice(1)}Shape`,g=`${n}D`;return`
  fn ${o}Index(globalIndex : i32) -> ${I(i)} {
    var coords = getCoordsFromIndex(globalIndex);
    ${p}
    return ${I(i)}(${a}[getIndexFromCoords${g}(${c}, ${f})${1===i?"":` / ${i}`}]);
  }

  fn ${o}Coords(coordsIn : ${l}) -> ${I(i)} {
    var coords = coordsIn;
    ${p}
    return ${I(i)}(${a}[getIndexFromCoords${g}(${c}, ${f})${1===i?"":` / ${i}`}]);
  }
`}(e,a,s,o)),n}).join("\n");h.push(p),h.push(i.getUserCode());let c=_(i);return h.push(P(c,i)),h.join("\n")}(i,{dtype:r.dtype,shape:r.shape},t),o=e.createShaderModule({code:s,label:t.constructor.name}),n=(0,m.env)().get("WEBGPU_PRINT_SHADER");if(""!==n){let e=(n=n.toLowerCase()).split(",");("all"===n||e.some(e=>t.shaderKey.toLowerCase().includes(e)))&&(console.group(t.shaderKey),console.debug(s),console.groupEnd())}return a?e.createComputePipelineAsync({compute:{module:o,entryPoint:"_start"},label:t.constructor.name,layout:"auto"}):e.createComputePipeline({compute:{module:o,entryPoint:"_start"},label:t.constructor.name,layout:"auto"})},I=(e,t="f32")=>{switch(e){case 1:return`${t}`;case 2:return`vec2<${t}>`;case 3:return`vec3<${t}>`;case 4:return`vec4<${t}>`;default:throw Error(`${e}-component ${t} is not supported.`)}};function k(e){if(e<=1)return"i32";if(2===e)return"vec2<i32>";if(3===e)return"vec3<i32>";if(4===e)return"vec4<i32>";if(5===e)return"vec5";if(6===e)return"vec6";throw Error(`GPU for rank ${e} is not yet supported`)}function R(e){if(0===e)return"x";if(1===e)return"y";if(2===e)return"z";if(3===e)return"w";if(4===e)return"u";if(5===e)return"v";throw Error(`Index ${e} is not yet supported`)}function $(...e){let t;switch(e.length){case 0:t=`
        fn main()
      `;break;case 1:t=`
        fn main(${e[0]} : i32)
      `;break;default:throw Error("Unreachable")}return t}function P(e,t){return`
     
  @compute @workgroup_size(${t.workgroupSize[0]}, ${t.workgroupSize[1]}, ${t.workgroupSize[2]})

      fn _start(@builtin(local_invocation_id) LocalId : vec3<u32>,
                @builtin(global_invocation_id) GlobalId : vec3<u32>,
                @builtin(local_invocation_index) LocalIndex: u32,
                @builtin(workgroup_id) WorkgroupId : vec3<u32>,
                @builtin(num_workgroups) NumWorkgroups : vec3<u32>) {
        localId = LocalId;
        localIndex = LocalIndex;
        globalId = GlobalId;
        numWorkgroups = NumWorkgroups;
        workgroupId = WorkgroupId;
        ${e?"main(getGlobalIndex());":"main();"};
      }
    `}let z=`
  struct vec5 {x: i32, y: i32, z: i32, w: i32, u: i32};
  struct vec6 {x: i32, y: i32, z: i32, w: i32, u: i32, v: i32};

  // Checks whether coordinates lie within the bounds of the shape.
  fn coordsInBounds2D(coord : vec2<i32>, shape : vec2<i32>) -> bool {
    return all(coord >= vec2<i32>(0)) && all(coord < shape);
  }
  fn coordsInBounds3D(coord : vec3<i32>, shape : vec3<i32>) -> bool {
    return all(coord >= vec3<i32>(0)) && all(coord < shape);
  }
  fn coordsInBounds4D(coord : vec4<i32>, shape : vec4<i32>) -> bool {
    return all(coord >= vec4<i32>(0)) && all(coord < shape);
  }

  fn getIndexFromCoords1D(coord : i32, shape : i32) -> i32 {
    return coord;
  }
  fn getIndexFromCoords2D(coords : vec2<i32>, shape : vec2<i32>) -> i32 {
    return dot(coords, vec2<i32>(shape.y, 1));
  }
  fn getIndexFromCoords3D(coords : vec3<i32>, shape : vec3<i32>) -> i32 {
    return dot(coords, vec3<i32>(shape.y * shape.z, shape.z, 1));
  }
  fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
    return dot(coords, vec4<i32>(
        shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
  }
  fn getIndexFromCoords5D(coords : vec5, shape : vec5) -> i32 {
    let shapeStrides: vec5 = vec5(shape.y * shape.z * shape.w * shape.u, shape.z * shape.w * shape.u, shape.w * shape.u, shape.u, 1);
    return coords.x*shapeStrides.x + coords.y*shapeStrides.y + coords.z*shapeStrides.z + coords.w*shapeStrides.w + coords.u*shapeStrides.u;
  }
  fn getIndexFromCoords6D(coords : vec6, shape : vec6) -> i32 {
    let shapeStrides: vec6 = vec6(shape.y * shape.z * shape.w * shape.u * shape.v, shape.z * shape.w * shape.u * shape.v, shape.w * shape.u * shape.v, shape.u * shape.v, shape.v, 1);
    return coords.x*shapeStrides.x + coords.y*shapeStrides.y + coords.z*shapeStrides.z + coords.w*shapeStrides.w + coords.u*shapeStrides.u + coords.v*shapeStrides.v;
  }

  // NaN defination in IEEE 754-1985 is :
  //   - sign = either 0 or 1.
  //   - biased exponent = all 1 bits.
  //   - fraction = anything except all 0 bits (since all 0 bits represents infinity).
  // https://en.wikipedia.org/wiki/IEEE_754-1985#Representation_of_non-numbers
  fn isnan(val: f32) -> bool {
    let floatToUint: u32 = bitcast<u32>(val);
    return (floatToUint & 0x7fffffffu) > 0x7f800000u;
  }
  fn isnanVec4(val : vec4<f32>) -> vec4<bool> {
    let floatToUint: vec4<u32> = bitcast<vec4<u32>>(val);
    return (floatToUint & vec4<u32>(0x7fffffffu)) > vec4<u32>(0x7f800000u);
  }
`,N=`
  fn isinf(val: f32) -> bool {
    return abs(val) == uniforms.INFINITY;
  }
`;function A(e,t=""){let i;let r=e.length,a=""!==t?`get${t.charAt(0).toUpperCase()+t.slice(1)}CoordsFromIndex`:"getCoordsFromIndex",s=""!==t?`${t.charAt(0).toLowerCase()+t.slice(1)}ShapeStrides`:"outShapeStrides";if(r<=1)return`fn ${a}(index : i32) -> i32 { return index; }`;let o=m.util.computeStrides(e),n=k(r),u=[];for(let e=0;e<r;e++)u.push(`d${e}`);return 1===o.length?`    fn ${a}(index : i32) -> vec2<i32> {
      let d0 = index / uniforms.${s}; let d1 = index - d0 * uniforms.${s};
      return vec2<i32>(d0, d1);
    }`:(i="var index2 = index;"+o.map((e,t)=>{let i=`let ${u[t]} = index2 / uniforms.${s}.${R(t)}`,r=t===o.length-1?`let ${u[t+1]} = index2 - ${u[t]} * uniforms.${s}.${R(t)}`:`index2 = index2 - ${u[t]} * uniforms.${s}.${R(t)}`;return`${i}; ${r};`}).join(""),`
    fn ${a}(index : i32) -> ${n} {
      ${i}
      return ${n}(${u.join(",")});
    }
  `)}function D(e){return 1===e.dispatch[1]&&1===e.dispatch[2]}function F(e,t=1){if("float32"===e)return I(t,"f32");if("int32"===e||"bool"===e)return I(t,"i32");throw Error(`type ${e} is not supported.`)}function _(e){return!(e.dispatchLayout.hasOwnProperty("y")&&0!==e.dispatchLayout.y.length||e.dispatchLayout.hasOwnProperty("z")&&0!==e.dispatchLayout.z.length)}let T=e=>{let t=1;for(let i=0;i<e.length;i++)t*=e[i];return t};function L(e,t){if(e.length!==t.length)throw Error(`Cannot compute whether rank ${e.length} tiles fit evenly into rank ${t.length} shape - ranks must match.`);return t.every((t,i)=>t%e[i]==0)}function E(e,t,i=[1,1,1],r=[1,1,1]){let[a,s,o]=[Math.ceil(T(e.x.map(e=>t[e]))/(i[0]*r[0])),e.y?Math.ceil(T(e.y.map(e=>t[e]))/(i[1]*r[1])):1,e.z?Math.ceil(T(e.z.map(e=>t[e]))/(i[2]*r[2])):1];return[a,s,o]}function B(e,t,i,r=!1){let a=[8,8,1],s=[4,4,1];return!r&&(e<=8&&(s[1]=1),t<=16&&i<=16&&(a[0]=4)),{workgroupSize:a,elementsPerThread:s}}function W(e,t,i=!1){if(i)return[8,8,1];let r=T(e.x.map(e=>t[e])),a=T(e.y.map(e=>t[e]));return r<=4?[4,16,1]:a<=4?[16,4,1]:[16,16,1]}function O(e,t,i=!1){if(i)return[4,4,1];let r=T(e.x.map(e=>t[e])),a=T(e.y.map(e=>t[e]));return r<=4?[1,2,1]:a<=4?[2,1,1]:[2,2,1]}function U(e){return{x:e.map((e,t)=>t)}}function V(e){if("float32"===e||"int32"===e||"bool"===e||"string"===e)return 4;if("complex64"===e)return 8;throw Error(`Unknown dtype ${e}`)}function M(){return!!("undefined"!=typeof globalThis&&globalThis.navigator&&globalThis.navigator.gpu)}function G(e,t){Array.isArray(e)||(e=[e]),e.forEach(e=>{null!=e&&m.util.assert("complex64"!==e.dtype,()=>`${t} does not support complex64 tensors in the WebGPU backend.`)})}(s=d||(d={}))[s.MatMulReduceProgram=0]="MatMulReduceProgram",s[s.MatMulSplitKProgram=1]="MatMulSplitKProgram",s[s.MatMulSmallOutputSizeProgram=2]="MatMulSmallOutputSizeProgram",s[s.MatMulPackedProgram=3]="MatMulPackedProgram",s[s.MatMulMax=4]="MatMulMax";let H=(0,m.env)().getNumber("WEBGPU_CPU_HANDOFF_SIZE_THRESHOLD"),X=(e,t)=>{let i=e.limits.maxComputeWorkgroupsPerDimension,r=t.dispatchLayout,a=t.dispatch;if(a.every(e=>e<=i))return a;m.util.assert(a[0]>i&&void 0===r.y&&void 0===r.z,()=>"Dispatch size exceeds WebGPU limits in Y or Z dimension.");let s=Math.ceil(Math.sqrt(a[0]));return s>i?(s=Math.ceil(Math.cbrt(a[0])),m.util.assert(s<=i,()=>"Total dispatch size exceeds WebGPU maximum."),[s,s,s]):[s,s,1]};class K extends m.KernelBackend{nextDataId(){return K.nextDataId++}constructor(e,t){if(super(),this.commandQueueOwnedIds=new WeakSet,this.dispatchCountInPass=0,this.disposed=!1,this.downloadWaitMs=0,this.tensorDataPendingDisposal=[],this.queryResolveBuffer=null,this.querySet=null,this.querySetCount=2,this.stagingPendingDisposal=[],this.uniformPendingDisposal=[],this.uploadWaitMs=0,this.hasReadSyncWarned=!1,this.hasTimestampQueryWarned=!1,!M())throw Error("WebGPU is not supported on this device");this.pipelineCache={},this.device=e,this.queue=e.queue,this.commandEncoder=null,this.computePassEncoder=null,this.adapterInfo=new x(t),this.supportTimestampQuery=this.device.features.has("timestamp-query"),this.thresholdToIncreaseWorkgroups=this.adapterInfo.intelGPUGeneration>=12?16:8,this.bufferManager=new y(this.device),this.textureManager=new w(this.device),this.tensorMap=new m.DataStorage(this,(0,m.engine)()),(0,m.env)().getBool("WEBGPU_USE_PROFILE_TOOL")&&(this.dummyCanvas=document.createElement("canvas"),this.dummyCanvas.width=1,this.dummyCanvas.height=1,this.dummyContext=this.dummyCanvas.getContext("webgpu"),this.dummyContext.configure({device:e,format:"bgra8unorm"}),document.body.appendChild(this.dummyCanvas))}floatPrecision(){return 32}disposeData(e,t=!1){if(!this.tensorMap.has(e))return!0;let i=this.tensorMap.get(e);return t?i.refCount=0:i.refCount--,!(i.refCount>0)&&((null!=i.complexTensorInfos&&(this.disposeData(i.complexTensorInfos.real.dataId),this.disposeData(i.complexTensorInfos.imag.dataId)),this.commandQueueOwnedIds.has(e))?this.tensorDataPendingDisposal.push(e):(this.releaseResource(e),this.tensorMap.delete(e)),!0)}memory(){return{numBytesInGPU:this.bufferManager.numBytesUsed,numBytesAllocatedInGPU:this.bufferManager.numBytesAllocated,unreliable:!1}}releaseResource(e){let t=this.tensorMap.get(e);if(t&&t.resource){if(t.external){t.resource=null;return}t.resource instanceof GPUBuffer?this.bufferManager.releaseBuffer(t.resource):t.resource instanceof GPUTexture&&this.textureManager.releaseTexture(t.resource),t.resource=null}}refCount(e){return this.tensorMap.has(e)?this.tensorMap.get(e).refCount:0}incRef(e){let t=this.tensorMap.get(e);t.refCount++}decRef(e){if(this.tensorMap.has(e)){let t=this.tensorMap.get(e);t.refCount--}}write(e,t,i){if("complex64"===i&&null!=e)throw Error("Cannot write to a complex64 dtype. Please use tf.complex(real, imag).");let r={id:this.nextDataId()};return this.tensorMap.set(r,{dtype:i,shape:t,values:e,refCount:1}),r}move(e,t,i,r,a){if("complex64"===r)throw Error("Cannot write to a complex64 dtype. Please use tf.complex(real, imag).");this.tensorMap.set(e,{dtype:r,shape:i,values:t,refCount:a})}submitQueue(){this.queue.submit([this.commandEncoder.finish()]),this.commandEncoder=null,this.dispatchCountInPass=0,this.commandQueueOwnedIds=new WeakSet,this.tensorDataPendingDisposal.forEach(e=>{this.releaseResource(e),this.tensorMap.delete(e)}),this.uniformPendingDisposal.forEach(e=>this.bufferManager.releaseBuffer(e)),this.stagingPendingDisposal.forEach(e=>this.bufferManager.releaseBuffer(e,!1)),this.tensorDataPendingDisposal=[],this.uniformPendingDisposal=[],this.stagingPendingDisposal=[]}ensureCommandEncoderReady(){this.commandEncoder||(this.commandEncoder=this.device.createCommandEncoder())}endComputePassEncoder(){this.computePassEncoder&&(this.computePassEncoder.end(),this.computePassEncoder=null)}async checkCompileCompletionAsync(){let e;try{e=await Promise.all(Object.values(this.pipelineCache))}catch(e){throw Error(e.message)}Object.keys(this.pipelineCache).map((t,i)=>{this.pipelineCache[t]=e[i]})}async getBufferData(e){if((0,m.env)().getBool("WEBGPU_ENGINE_COMPILE_ONLY"))return console.warn("The data may be invalid since WEBGPU_ENGINE_COMPILE_ONLY is true, this can only be called when WEBGPU_ENGINE_COMPILE_ONLY is false"),null;let t=e.size,i=this.bufferManager.acquireBuffer(t,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,i,0,t),this.submitQueue(),await i.mapAsync(GPUMapMode.READ);let r=i.getMappedRange().slice(0);return i.unmap(),null!=i&&this.bufferManager.releaseBuffer(i),(0,m.env)().getBool("WEBGPU_USE_PROFILE_TOOL")&&(m.util.assert(void 0!==this.dummyContext,()=>"Fail to get context for profiling tool"),this.dummyContext.getCurrentTexture()),r}convertAndCacheOnCPU(e,t){let i=this.tensorMap.get(e);return i.values=t,i.values}readSync(e){let t=this.tensorMap.get(e),{values:i,complexTensorInfos:r}=t;if(null!=i||"string"===t.dtype)return i;if("complex64"===t.dtype){let t=this.readSync(r.real.dataId),i=this.readSync(r.imag.dataId),a=m.util.convertBackendValuesAndArrayBuffer(m.backend_util.mergeRealAndImagArrays(t,i).buffer,"float32");return this.convertAndCacheOnCPU(e,a),a}this.hasReadSyncWarned||(this.hasReadSyncWarned=!0,console.warn("The performance of synchronously reading data from GPU to CPU is poor on the webgpu backend, please use asynchronous APIs instead."));let a=["opaque","premultiplied"],s=t.resource,o=s.size;m.util.assert(o%4==0,()=>"Because there is 4 bytes for one pixel, buffer size must be multiple of 4.");let n=o/4,u=new ArrayBuffer(o),l=a.map(e=>new OffscreenCanvas(256,256)),d=new OffscreenCanvas(256,256);this.endComputePassEncoder(),l.map((e,t)=>{let i=e.getContext("webgpu");return i.configure({device:this.device,format:"bgra8unorm",usage:GPUTextureUsage.COPY_DST,alphaMode:a[t]}),i.getCurrentTexture()}).map((e,t)=>{let i=(i,r,o)=>{this.ensureCommandEncoderReady(),this.commandEncoder.copyBufferToTexture({buffer:s,bytesPerRow:1024,offset:o},{texture:e},{width:i,height:r}),this.submitQueue();let n=d.getContext("2d",{willReadFrequently:!0});n.clearRect(0,0,i,r),n.drawImage(l[t],0,0);let h=n.getImageData(0,0,i,r).data,p=a[t],c=new Uint8ClampedArray(u,o,i*r*4);for(let e=0;e<c.length;e+=4)if("premultiplied"===p)c[e+3]=h[e+3];else{let t=h[e];c[e]=h[e+2],c[e+1]=h[e+1],c[e+2]=t}},r=Math.floor(n/65536),o=256,h=256,p=0;for(let e=0;e<r;e++)i(o,h,p),p+=262144;let c=n%65536;(h=Math.floor(c/256))>0&&(i(o,h,p),p+=1024*h),(o=c%256)>0&&i(o,1,p)});let h=m.util.convertBackendValuesAndArrayBuffer(u,t.dtype);return this.convertAndCacheOnCPU(e,h),h}async read(e){let t;if(!this.tensorMap.has(e))throw Error(`Tensor ${e} was not registered!`);let i=this.tensorMap.get(e),{values:r}=i;if(null!=r)return r;if("complex64"===i.dtype){let e=await Promise.all([this.read(i.complexTensorInfos.real.dataId),this.read(i.complexTensorInfos.imag.dataId)]),r=e[0],a=e[1];t=m.backend_util.mergeRealAndImagArrays(r,a)}else{let e=await this.getBufferData(i.resource);t=m.util.convertBackendValuesAndArrayBuffer(e,i.dtype)}return this.convertAndCacheOnCPU(e,t),t}copyBuffer(e){let t=e.size,i=e.usage,r=this.bufferManager.acquireBuffer(t,i);return this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,r,0,t),this.submitQueue(),r}createTensorFromGPUData(e,t,i){let r=e.buffer;if("complex64"===i)throw Error("Cannot write to a complex64 dtype. ");let a={id:this.nextDataId()};this.tensorMap.set(a,{dtype:i,shape:t,values:null,refCount:1,external:e.zeroCopy});let s=this.tensorMap.get(a),o=V(s.dtype)*m.util.sizeFromShape(s.shape);if(e.buffer.size<o)throw Error(`GPUBuffer size(${e.buffer.size}) is smaller than tensor size(${o})!`);if((e.buffer.usage&(GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC))!=(GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC))throw Error("GPUBuffer.usage should include GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC!");return!0!==e.zeroCopy&&(r=this.copyBuffer(r)),s.resource=r,(0,m.engine)().makeTensorFromDataId(a,t,i,this)}readToGPU(e){let{values:t,dtype:i,shape:r,resource:a}=this.tensorMap.get(e);if("complex64"===i)throw Error("Does not support reading buffer for complex64 dtype.");if(null==a){if(null!=t)throw Error("Data is not on GPU but on CPU.");throw Error("There is no data on GPU or CPU.")}let s=a.size,o=a.usage,n=this.bufferManager.acquireBuffer(s,o);this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(a,0,n,0,s),this.submitQueue();let u=this.makeTensorInfo(r,i),l=(0,m.engine)().makeTensorFromTensorInfo(u);return this.tensorMap.get(u.dataId).resource=n,{tensorRef:l,buffer:n}}bufferSync(e){let t=this.readSync(e.dataId);if("string"===e.dtype)try{let i=t.map(e=>m.util.decodeString(e));return(0,m.buffer)(e.shape,e.dtype,i)}catch(e){throw Error("Failed to decode encoded string bytes into utf-8")}return(0,m.buffer)(e.shape,e.dtype,t)}async time(e){this.supportTimestampQuery||this.hasTimestampQueryWarned||(console.warn("This device doesn't support timestamp-query extension. Start Chrome browser with flag --enable-dawn-features=allow_unsafe_apis to try it again. Otherwise, zero will be shown for the kernel time when profiling mode is enabled."),this.hasTimestampQueryWarned=!0);let t=this.activeTimers,i=[],r=!1;null==this.programTimersStack?(this.programTimersStack=i,r=!0):this.activeTimers.push(i),this.activeTimers=i,e();let a=m.util.flatten(this.activeTimers.map(e=>e.query)).filter(e=>null!=e),s=m.util.flatten(this.activeTimers.map(e=>e.name)).filter(e=>null!=e);this.activeTimers=t,r&&(this.programTimersStack=null);let o={uploadWaitMs:this.uploadWaitMs,downloadWaitMs:this.downloadWaitMs,kernelMs:null,wallMs:null},n=await Promise.all(a);return o.kernelMs=m.util.sum(n),o.getExtraProfileInfo=()=>n.map((e,t)=>({name:s[t],ms:e})).map(e=>`${e.name}: ${e.ms}`).join(", "),this.uploadWaitMs=0,this.downloadWaitMs=0,o}makeTensorInfo(e,t,i){return"string"===t&&null!=i&&i.length>0&&m.util.isString(i[0])&&(i=i.map(e=>m.util.encodeString(e))),{dataId:this.write(i,e,t),shape:e,dtype:t}}tensorToBinding(e){if(!e)return null;let t=this.tensorMap.get(e.dataId).resource;return t instanceof GPUBuffer?{buffer:t}:t instanceof GPUTexture?t.createView():t}uploadToGPU(e){let t;let i=this.tensorMap.get(e);if(null!=i.resource)return;let r=V(i.dtype)*m.util.sizeFromShape(i.shape),a=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;if(i.values){if("unmapped"===(t=this.bufferManager.acquireBuffer(r,a,!0)).mapState){let e=this.bufferManager.acquireBuffer(r,GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC,!0,!1),a=e.getMappedRange();"int32"===i.dtype||"bool"===i.dtype?new Int32Array(a).set(i.values):new Float32Array(a).set(i.values),e.unmap(),this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,t,0,r),this.stagingPendingDisposal.push(e)}else{let e=t.getMappedRange();"int32"===i.dtype||"bool"===i.dtype?new Int32Array(e).set(i.values):new Float32Array(e).set(i.values),t.unmap()}i.values=null}else t=this.bufferManager.acquireBuffer(r,a);i.resource=t}makeUniforms(e){let t=0,i=0,r=[],a=1;e.forEach(e=>{let s;switch(0===e.data.length&&(e.data=[1]),e.data.length){case 1:s=4;break;case 2:s=8;break;case 3:case 4:case 5:case 6:s=16;break;default:m.util.assert(!1,()=>`Unsupported ${e.data.length}D shape`)}(5===i||6===i)&&(s=16),s>a&&(a=s),t=Math.ceil(t/s)*s,i=e.data.length,r.push(t),t+=4*e.data.length});let s=new ArrayBuffer(t=Math.ceil(t/a)*a);e.forEach((e,t)=>{let i=r[t];"int32"===e.type?new Int32Array(s,i,e.data.length).set(e.data):"uint32"===e.type?new Uint32Array(s,i,e.data.length).set(e.data):new Float32Array(s,i,e.data.length).set(e.data)});let o=this.bufferManager.acquireBuffer(t,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);return this.queue.writeBuffer(o,0,s,0,t),this.uniformPendingDisposal.push(o),{offset:0,size:t,buffer:o}}runWebGPUProgram(e,t,i,r,a){if(a||(a=this.makeTensorInfo(e.outputShape,i)),0===m.util.sizeFromShape(a.shape))return this.tensorMap.get(a.dataId).values=m.util.getTypedArrayFromDType(a.dtype,0),a;this.uploadToGPU(a.dataId),e.dispatch=X(this.device,e);let s=t.map((t,i)=>{if("complex64"===t.dtype)throw Error("GPGPUProgram does not support complex64 input. For complex64 dtypes, please separate the program into real and imaginary parts.");return this.uploadToGPU(t.dataId),{dtype:this.tensorMap.get(t.dataId).dtype,shape:t.shape,name:e.variableNames[i]}});e.shaderKey=function(e,t,i){let r=e.shaderKey;if(null!=e.pixelsOpType)return r;let a=[],s=[];t.forEach(e=>{a.push(e.shape),s.push(e.dtype)}),a.push(i.shape),s.push(i.dtype);let o=t.map(e=>m.backend_util.getBroadcastDims(e.shape,i.shape)),n=t.map(e=>m.util.arraysEqual(e.shape,i.shape)).join("_"),u=o.map(e=>e.join("_")).join(";"),l=D(e)?"flatDispatch":"";return r+("_"+(e.workgroupSize?e.workgroupSize.join(","):"")+a.map(e=>e.length).join(",")+s.join(",")+e.variableNames.join(",")+u+n)+l}(e,s,a);let o=(0,m.env)().getBool("WEBGPU_ENGINE_COMPILE_ONLY");return e.shaderKey in this.pipelineCache||(this.pipelineCache[e.shaderKey]=v(this.device,e,s,a,o)),e.pipeline=this.pipelineCache[e.shaderKey],o||this.recordAndSubmit(e,a,t,r),a}recordAndSubmit(e,t,i,r){if(e.pipeline instanceof Promise)throw Error("Please call checkCompileCompletionAsync to ensure parallel compilation is done!");let a=[],s=[],o="int32";if(null==e.pixelsOpType){a.push({type:"float32",data:[NaN]},{type:"float32",data:[1/0]});let e="int32";i.concat(t).map(e=>e.shape).map(t=>{a.push({type:e,data:t});let i=m.util.computeStrides(t);a.push({type:e,data:i})})}else{let e=m.util.computeStrides(t.shape);a.push({type:o,data:e})}if(e.size){let t=m.util.sizeFromShape(e.outputShape);a.push({type:o,data:[e.outputComponent?t/e.outputComponent:t]})}r&&(a=[...a,...r]);let n=[this.tensorToBinding(t),...i.map(e=>this.tensorToBinding(e)),this.makeUniforms(a)];i.forEach(e=>{this.commandQueueOwnedIds.add(e.dataId)}),this.commandQueueOwnedIds.add(t.dataId);let u=this.device.createBindGroup({layout:e.pipeline.getBindGroupLayout(0),entries:n.map((e,t)=>({binding:t,resource:e}))}),d=null!=this.activeTimers;this.ensureCommandEncoderReady();let h={};d&&this.supportTimestampQuery?(this.endComputePassEncoder(),null==this.querySet&&(this.querySet=this.device.createQuerySet({type:"timestamp",count:this.querySetCount})),h.timestampWrites={querySet:this.querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1},this.computePassEncoder=this.commandEncoder.beginComputePass(h)):this.computePassEncoder||(this.computePassEncoder=this.commandEncoder.beginComputePass(h)),this.computePassEncoder.setPipeline(e.pipeline),this.computePassEncoder.setBindGroup(0,u),this.computePassEncoder.dispatchWorkgroups(e.dispatch[0],e.dispatch[1],e.dispatch[2]),this.dispatchCountInPass++,(d||(0,m.env)().get("WEBGPU_DEFERRED_SUBMIT_BATCH_SIZE")<=this.dispatchCountInPass||e.pixelsOpType===l.DRAW)&&(this.endComputePassEncoder(),d?this.activeTimers.push({name:e.constructor.name,query:this.getQueryTime()}):this.submitQueue())}async getQueryTime(){if(!this.supportTimestampQuery)return 0;null==this.queryResolveBuffer&&(this.queryResolveBuffer=this.bufferManager.acquireBuffer(8*this.querySetCount,GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|GPUBufferUsage.QUERY_RESOLVE)),this.commandEncoder.resolveQuerySet(this.querySet,0,this.querySetCount,this.queryResolveBuffer,0);let e=this.bufferManager.acquireBuffer(8*this.querySetCount,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer,0,e,0,8*this.querySetCount),this.submitQueue(),await e.mapAsync(GPUMapMode.READ);let t=new BigUint64Array(e.getMappedRange()),i=Number(t[1]-t[0])/1e6;return e.unmap(),this.bufferManager.releaseBuffer(e),i}shouldExecuteOnCPU(e,t=H){return(0,m.env)().getBool("WEBGPU_CPU_FORWARD")&&e.every(e=>null==this.tensorMap.get(e.dataId).resource&&m.util.sizeFromShape(e.shape)<t)}numDataIds(){return this.tensorMap.numDataIds()-this.tensorDataPendingDisposal.length}dispose(){this.disposed||(null!=this.querySet&&this.querySet.destroy(),this.bufferManager.dispose(),this.textureManager.dispose(),this.disposed=!0)}}K.nextDataId=0,M()&&(0,m.registerBackend)("webgpu",async()=>{let e={powerPreference:(0,m.env)().get("WEBGPU_USE_LOW_POWER_GPU")?"low-power":"high-performance"},t=await navigator.gpu.requestAdapter(e),i={},r=[];t.features.has("timestamp-query")&&r.push("timestamp-query"),t.features.has("bgra8unorm-storage")&&r.push(["bgra8unorm-storage"]),i.requiredFeatures=r;let a=t.limits;return i.requiredLimits={maxComputeWorkgroupStorageSize:a.maxComputeWorkgroupStorageSize,maxComputeWorkgroupsPerDimension:a.maxComputeWorkgroupsPerDimension,maxStorageBufferBindingSize:a.maxStorageBufferBindingSize,maxBufferSize:a.maxBufferSize,maxComputeWorkgroupSizeX:a.maxComputeWorkgroupSizeX,maxComputeInvocationsPerWorkgroup:a.maxComputeInvocationsPerWorkgroup},new K(await t.requestDevice(i),"info"in t?t.info:"requestAdapterInfo"in t?await t.requestAdapterInfo():void 0)},3),(o=h||(h={}))[o.ADD=0]="ADD",o[o.ATAN2=1]="ATAN2",o[o.COMPLEX_MULTIPLY_IMAG=2]="COMPLEX_MULTIPLY_IMAG",o[o.COMPLEX_MULTIPLY_REAL=3]="COMPLEX_MULTIPLY_REAL",o[o.DIV=4]="DIV",o[o.ELU_DER=5]="ELU_DER",o[o.EQUAL=6]="EQUAL",o[o.FLOOR_DIV=7]="FLOOR_DIV",o[o.GREATER=8]="GREATER",o[o.GREATER_EQUAL=9]="GREATER_EQUAL",o[o.LESS=10]="LESS",o[o.LESS_EQUAL=11]="LESS_EQUAL",o[o.LOGICAL_AND=12]="LOGICAL_AND",o[o.LOGICAL_OR=13]="LOGICAL_OR",o[o.MAX=14]="MAX",o[o.MIN=15]="MIN",o[o.MOD=16]="MOD",o[o.MUL=17]="MUL",o[o.NOT_EQUAL=18]="NOT_EQUAL",o[o.POW=19]="POW",o[o.PRELU=20]="PRELU",o[o.SQUARED_DIFFERENCE=21]="SQUARED_DIFFERENCE",o[o.SUB=22]="SUB";let q=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a == b);
`,Y=`
  let remainder =
      select(a % b, round(a % b), (round(a) == a) & (round(b) == b));
  let quotient = (a - remainder) / b;
  let resultTemp =
      round(select(quotient, quotient - 1, sign(remainder) == -sign(b)));
`,j=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a > b);
`,Q=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a >= b);
`,Z=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a < b);
`,J=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a <= b);
`,ee=`return (vec4<f32>(a >= vec4<f32>(1.0)) *
  vec4<f32>(b >= vec4<f32>(1.0)));`,et=`return min(vec4<f32>(a >= vec4<f32>(1.0)) +
  vec4<f32>(b >= vec4<f32>(1.0)), vec4<f32>(1.0));`,ei=`
  let isNaN = b == 0.;
  var resultTemp = a % b;
  resultTemp = select((resultTemp + b) % b, resultTemp,
      (a < 0. && b < 0.) || (a >= 0. && b > 0.));
`,er=`
  let isNaN = !vec4<bool>(b);
  var resultTemp = vec4<f32>(a % b);
  if (!((a[0] < 0. && b[0] < 0.) || (a[0] >= 0. && b[0] > 0.))) {
    resultTemp[0] = (resultTemp[0] + b[0]) % b[0];
  }
  if (!((a[1] < 0. && b[1] < 0.) || (a[1] >= 0. && b[1] > 0.))) {
    resultTemp[1] = (resultTemp[1] + b[1]) % b[1];
  }
  if (!((a[2] < 0. && b[2] < 0.) || (a[2] >= 0. && b[2] > 0.))) {
    resultTemp[2] = (resultTemp[2] + b[2]) % b[2];
  }
  if (!((a[3] < 0. && b[3] < 0.) || (a[3] >= 0. && b[3] > 0.))) {
    resultTemp[3] = (resultTemp[3] + b[3]) % b[3];
  }
`,ea=`
  var resultTemp = f32(a != b);
  let valueForNaN = 1.0;
`,es=`
  var resultTemp = vec4<f32>(a != b);
  let valueForNaN = 1.0;
`,eo=`
  let isNaN = a < 0.0 && floor(b) < b;
  if (b == 0.0) {
    return 1.0;
  }
  var resultTemp = select(sign(a) * pow(abs(a), b), pow(abs(a), b),
      round(abs(b) % 2.0) != 1.0);
`,en=`
  let isModRound1Bool = vec4<i32>(round(abs(b) % vec4<f32>(2.0))) == vec4<i32>(1);
  let isModRound1 = vec4<f32>(isModRound1Bool);
  let multiplier = sign(a) * isModRound1 + (vec4<f32>(1.0) - isModRound1);
  var resultTemp = multiplier * pow(abs(a), b);

  // Ensure that a^0 = 1, including 0^0 = 1 as this correspond to TF and JS
  let isExpZero = b == vec4<f32>(0.0);
  if (isExpZero.r) {
    resultTemp.r = 1.0;
  }
  if (isExpZero.g) {
    resultTemp.g = 1.0;
  }
  if (isExpZero.b) {
    resultTemp.b = 1.0;
  }
  if (isExpZero.a) {
    resultTemp.a = 1.0;
  }
  let isNaN = (a < vec4<f32>(0.0)) & (floor(b) < b);
`,eu=`
  let aLessThanZero = vec4<f32>(a < vec4<f32>(0.0));
  return (aLessThanZero * (b * a)) + ((vec4<f32>(1.0) - aLessThanZero) * a);
`;function el(e,t){let i;do{let r,a,s;switch(e){case h.ATAN2:i="let resultTemp = atan2(a, b);";break;case h.MAX:i="let resultTemp = max(a, b);";break;case h.MIN:i="let resultTemp = min(a, b);";break;case h.MOD:i=t?er:ei;break;case h.NOT_EQUAL:i=t?es:ea;break;case h.POW:i=t?en:eo;break;default:continue}return t?(r="isnanVec4",a="vec4<f32>",s="vec4<bool>"):(r="isnan",a="f32",s="bool"),`
      let aIsNaN = ${r}(a);
      let aPostLegalization = select(a, ${a}(42), aIsNaN);
      let bIsNaN = ${r}(b);
      let bPostLegalization = select(b, ${a}(42), bIsNaN);
      let isNaN = false;
      let valueForNaN = uniforms.NAN;
      {
        let a = aPostLegalization;
        let b = bPostLegalization;
        ${i}
        return select(
            resultTemp, ${a}(valueForNaN),
            ${s}(isNaN) | aIsNaN | bIsNaN);
      }
    `}while(!1);switch(e){case h.ADD:i="let resultTemp = a + b;";break;case h.COMPLEX_MULTIPLY_IMAG:i="let resultTemp = areal * bimag + aimag * breal;";break;case h.COMPLEX_MULTIPLY_REAL:i="let resultTemp = areal * breal - aimag * bimag;";break;case h.DIV:i="let resultTemp = a / b;";break;case h.ELU_DER:i="let resultTemp = select(a * (b + 1.0), a, b >= b - b);";break;case h.EQUAL:i=q;break;case h.FLOOR_DIV:i=Y;break;case h.GREATER:i=j;break;case h.GREATER_EQUAL:i=Q;break;case h.LESS:i=Z;break;case h.LESS_EQUAL:i=J;break;case h.LOGICAL_AND:return t?ee:"return f32(a >= 1.0 && b >= 1.0);";case h.LOGICAL_OR:return t?et:"return f32(a >= 1.0 || b >= 1.0);";case h.MUL:i="let resultTemp = a * b;";break;case h.PRELU:return t?eu:"if (a < 0.0) { return b * a; }  return a;";case h.SQUARED_DIFFERENCE:i="let resultTemp = (a - b) * (a - b);";break;case h.SUB:i="let resultTemp = a - b;"}return`
    ${i}
    return resultTemp;
  `}(n=p||(p={}))[n.ABS=0]="ABS",n[n.ACOS=1]="ACOS",n[n.ACOSH=2]="ACOSH",n[n.ASIN=3]="ASIN",n[n.ASINH=4]="ASINH",n[n.ATAN=5]="ATAN",n[n.ATANH=6]="ATANH",n[n.CEIL=7]="CEIL",n[n.COS=8]="COS",n[n.COSH=9]="COSH",n[n.ELU=10]="ELU",n[n.ERF=11]="ERF",n[n.EXP=12]="EXP",n[n.EXPM1=13]="EXPM1",n[n.FLOOR=14]="FLOOR",n[n.IS_FINITE=15]="IS_FINITE",n[n.IS_INF=16]="IS_INF",n[n.IS_NAN=17]="IS_NAN",n[n.LINEAR=18]="LINEAR",n[n.LOG=19]="LOG",n[n.LOG1P=20]="LOG1P",n[n.LOGICAL_NOT=21]="LOGICAL_NOT",n[n.NEG=22]="NEG",n[n.RELU=23]="RELU",n[n.RELU6=24]="RELU6",n[n.LEAKYRELU=25]="LEAKYRELU",n[n.RECIPROCAL=26]="RECIPROCAL",n[n.ROUND=27]="ROUND",n[n.RSQRT=28]="RSQRT",n[n.SELU=29]="SELU",n[n.SIGMOID=30]="SIGMOID",n[n.SIGN=31]="SIGN",n[n.SIN=32]="SIN",n[n.SINH=33]="SINH",n[n.SOFTPLUS=34]="SOFTPLUS",n[n.SQRT=35]="SQRT",n[n.SQUARE=36]="SQUARE",n[n.STEP=37]="STEP",n[n.TAN=38]="TAN",n[n.TANH=39]="TANH",n[n.TO_INT=40]="TO_INT";let ed=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  return acos(a);
`,eh=`
  if (a < 1.) {
    return uniforms.NAN;
  }
  return acosh(a);
`,ep=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  return asin(a);
`,ec=`
  if (isnan(a)) {
    return uniforms.NAN;
  }
  return atan(a);
`,ef=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  if (a == 1.) {
    return uniforms.INFINITY;
  }
  if (a == -1.) {
    return -uniforms.INFINITY;
  }
  return atanh(a);
`,em=`
  let e2x = exp(-a);
  return (e2x + 1.0 / e2x) / 2.0;
`,eg=`
  var resFloat = exp(a) - vec4<f32>(1.0);
  if (a.r >= 0.0) {
    resFloat.r = a.r;
  }
  if (a.g >= 0.0) {
    resFloat.g = a.g;
  }
  if (a.b >= 0.0) {
    resFloat.b = a.b;
  }
  if (a.a >= 0.0) {
    resFloat.a = a.a;
  }
  return resFloat;
`,ex=`
  // Error function is calculated approximately with elementary function.
  // See "Handbook of Mathematical Functions with Formulas,
  // Graphs, and Mathematical Tables", Abramowitz and Stegun.
  let p = ${m.backend_util.ERF_P};
  let a1 = ${m.backend_util.ERF_A1};
  let a2 = ${m.backend_util.ERF_A2};
  let a3 = ${m.backend_util.ERF_A3};
  let a4 = ${m.backend_util.ERF_A4};
  let a5 = ${m.backend_util.ERF_A5};

  let sign = sign(a);
  let absA = abs(a);
  let t = 1.0 / (1.0 + p * absA);
  return sign * (1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * exp(-absA * absA));
`,ey=`if (a < 0.0) { return uniforms.NAN; }
  return log(a);`,ew=`
  if (isnan(a)) { return a; }
  return log(1.0 + a);
`,eb=`
  let aLessThanZero = vec4<f32>(a < vec4<f32>(0.0));
  return (aLessThanZero * (uniforms.alpha * a)) + ((vec4<f32>(1.0) - aLessThanZero) * a);
`,eC=`
  return select(a, vec4<f32>(0.0), a < vec4<f32>(0.0));
`,eS=`
  if (a >= 0.0) {
    return ${m.backend_util.SELU_SCALE} * a;
  } else {
    return ${m.backend_util.SELU_SCALEALPHA} * (exp(a) - 1.0);
  }
`,ev=`
  let e2x = exp(a);
  return (e2x - 1.0 / e2x) / 2.0;
`,eI=`
  let epsilon = 1.1920928955078125e-7;
  let threshold = log(epsilon) + 2.0;

  let too_large = a > -threshold;
  let too_small = a < threshold;
  let exp_a = exp(a);

  if (too_large) {
    return a;
  } else if (too_small) {
    return exp_a;
  } else {
    return log(exp_a + 1.0);
  }
`,ek=`
  if (isnan(a)) {
    return a;
  }

  return select(uniforms.stepAlpha, 1.0, a > 0.0);
`,eR=`
  let e2x = exp(-2.0 * abs(a));
  return sign(a) * (1.0 - e2x) / (1.0 + e2x);
`;function e$(e,t){switch(e){case p.ABS:return"return abs(a);";case p.ACOS:return ed;case p.ACOSH:return eh;case p.ASIN:return ep;case p.ASINH:return"return asinh(a);";case p.ATAN:return ec;case p.ATANH:return ef;case p.COS:return"return cos(a);";case p.COSH:return em;case p.CEIL:return"return ceil(a);";case p.ELU:return t?eg:"if (a >= 0.0) { return a; }  return (exp(a) - 1.0);";case p.ERF:return ex;case p.EXP:return"return exp(a);";case p.EXPM1:return"return exp(a) - 1.0;";case p.FLOOR:return"return floor(a);";case p.IS_FINITE:return"return f32(!isnan(a) && !isinf(a));";case p.IS_INF:return"return f32(isinf(a));";case p.IS_NAN:return"return f32(isnan(a));";case p.LINEAR:return"return a;";case p.LOG:return ey;case p.LOG1P:return ew;case p.LOGICAL_NOT:return"return f32(!(a >= 1.0));";case p.NEG:return"return -a;";case p.LEAKYRELU:return t?eb:"if (a < 0.0) { return uniforms.alpha * a; } return a;";case p.RECIPROCAL:return"return 1.0 / a;";case p.RELU:return t?eC:"return select(a, 0.0, a < 0.0);";case p.RELU6:return t?"return clamp(a, vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(6.0, 6.0, 6.0, 6.0));":"return clamp(a, 0.0, 6.0);";case p.ROUND:return"return round(a);";case p.RSQRT:return"return inverseSqrt(a);";case p.SELU:return eS;case p.SIGMOID:return"return 1.0 / (1.0 + exp(-1.0 * a));";case p.SIGN:return"return sign(a);";case p.SIN:return"return sin(a);";case p.SINH:return ev;case p.SOFTPLUS:return eI;case p.SQRT:return"return sqrt(a);";case p.SQUARE:return"return a * a;";case p.STEP:return ek;case p.TAN:return"return tan(a);";case p.TANH:return eR;case p.TO_INT:return"return f32(i32((a)));";default:throw Error(`BinaryType ${e} is not implemented!`)}}function eP(e,t=!1,i=!1,r=3){if(null===e)return"";let a="";if("linear"===e)a=e$(p.LINEAR);else if("relu"===e)a=e$(p.RELU,i);else if("elu"===e)a=e$(p.ELU,i);else if("relu6"===e)a=e$(p.RELU6,i);else if("prelu"===e)a=el(h.PRELU,i);else if("sigmoid"===e)a=e$(p.SIGMOID,i);else if("leakyrelu"===e)a=e$(p.LEAKYRELU,i);else throw Error(`Activation ${e} has not been implemented for the WebGPU backend.`);let s=I(i?4:1);return t?`
      fn activation(a : ${s}, coords : vec${r}<i32>) -> ${s} {
        let b = getPreluActivationWeightsByOutputCoords(coords);
        ${a}
      }`:`
      fn activation(a : ${s}, coords : vec${r}<i32>) -> ${s} {
        ${a}
      }`}function ez(e,t){return`
      ${e?"value = value + getBiasByOutputCoords(coords);":""}
      ${t?"value = activation(value, coords);":""}
      `}function eN(e,t,i=!1,r=!1,a=!1,s=1){m.util.assert(e&&1===s||!e,()=>`transposeA ${e} is not compatible with component size ${s}`);let o=`
      ${e?"value = getA(batch, col, row);":"value = getA(batch, row, col);"}

    `;return`
  fn mm_readA(batch: i32, row: i32, col: i32) -> ${I(s)} {
    var value = ${I(s)}(0.0);
    ${i&&a?o:`
    ${e?"if(row < uniforms.dimAOuter && col < uniforms.dimInner)":"if(row < uniforms.aShape[1] && col < uniforms.aShape[2])"}
    {
      ${o}
    }
    `}
    return value;
  }

  fn mm_readB(batch: i32, row: i32, col: i32) -> ${I(s)} {
    var value = ${I(s)}(0.0);
    ${t?"value = getB(batch, col, row);":"value = getB(batch, row, col);"}
    return value;
  }
  `}function eA(e,t,i,r,a=!1,s=!1,o=!1,n=1){return`
  ${eN(i,r,a,s,o,n)}
  fn mm_write(batch: i32, row: i32, col: i32, valueIn: ${I(n)}) {
    ${a&&s?"":"if (row < uniforms.dimAOuter && col < uniforms.dimBOuter)"}
    {
      var value = valueIn;
      let coords = vec3<i32>(batch, row, col);
      ${ez(e,t)}
      setOutputAtCoords(coords[0], coords[1], coords[2], value);
    }
  }
  `}let eD=(e,t)=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          kStart + inputRow,
          globalRowStart + inputCol * ${t});
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          globalRow + innerRow,
          kStart + inputCol * ${t});
        `,eF=(e,t,i,r)=>{if(e)return`
      for (var k = 0; k < ${r}; k++) {
        let BCached0 = mm_Bsub[k][tileCol];
        let ACached0 = mm_Asub[k][localRow];
        for (var i = 0; i < ${i}; i++) {
          acc[i] = fma(BCached0, vec4<f32>(ACached0[i]), acc[i]);
        }
      }`;{let e="",a="";for(let i=0;i<t;i++)e+=`let BCached${i} = mm_Bsub[k * ${t} + ${i}][tileCol];`,a+=`acc[i] = fma(BCached${i}, vec4<f32>(ACached[${i}]), acc[i]);`;return`
      for (var k = 0; k < ${r/t}; k++) {
        ${e}
        for (var i = 0; i < ${i}; i++) {
          let ACached = mm_Asub[tileRow + i][k];
          ${a}
        }
      }`}};function e_(e,t,i=!1,r=32,a=!1,s=32,o=!1){let n=t[1]*e[1],u=t[0]*e[0],l=i?n:r,d=i?r:n,h=l/t[0],p=r/t[1],c=e[1],f=e[0];return m.util.assert((i&&4===h&&4===e[1]||!i&&(3===h||4===h))&&l%t[0]==0&&r%t[1]==0&&4===e[0],()=>`If transposeA ${i} is true, innerElementSize ${h} and workPerThread[1] ${e[1]} must be 4.
          Otherwise, innerElementSize ${h} must be 3 or 4.
      tileAWidth ${l} must be divisible by workgroupSize[0]${t[0]}. tileInner ${r} must be divisible by workgroupSize[1] ${t[1]}. colPerThread ${e[0]} must be 4.`),`
  var<workgroup> mm_Asub : array<array<vec${h}<f32>, ${l/h}>, ${d}>;
  var<workgroup> mm_Bsub : array<array<vec4<f32>, ${u/e[0]}>, ${r}>;

  ${$()} {
    let localRow = i32(localId.y);
    let tileRow = localRow * ${c};
    let tileCol = i32(localId.x);

    let globalRow = i32(globalId.y) * ${c};
    let globalCol = i32(globalId.x) * ${f};
    let batch = ${a?"0":"i32(globalId.z)"};
    let batchA = ${a||!o?"batch":"batch % uniforms.aShape[0]"};
    let batchB = ${a||!o?"batch":"batch % uniforms.bShape[0]"};
    let globalRowStart = i32(workgroupId.y) * ${n};

    let numTiles = ${a?`${Math.ceil(s/r)}`:`(uniforms.dimInner - 1) / ${r} + 1`};
    var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

    var acc: array<vec4<f32>, ${c}>;

    // Loop over shared dimension.
    let tileRowB = localRow * ${p};
    for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        for (var innerRow = 0; innerRow < ${c}; innerRow++) {
            let inputRow = tileRow + innerRow;
            let inputCol = tileCol;
            ${eD(i,h)}
        }

        // Load one tile of B into local memory.
        for (var innerRow = 0; innerRow < ${p}; innerRow++) {
            let inputRow = tileRowB + innerRow;
            let inputCol = tileCol;
            mm_Bsub[inputRow][inputCol] = mm_readB(batchB, kStart + inputRow, globalCol);
        }
        kStart = kStart + ${r};
        workgroupBarrier();

        // Compute acc values for a single thread.
        ${eF(i,h,c,r)}
        workgroupBarrier();
    }

    for (var innerRow = 0; innerRow < ${c}; innerRow++) {
        mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
    }
  }`}let eT=e=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          kStart + inputRow,
          globalRowStart + inputCol);
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          globalRowStart + inputRow,
          kStart + inputCol);
        `,eL=e=>e?"let ACached = mm_Asub[k][tileRow + innerRow];":"let ACached = mm_Asub[tileRow + innerRow][k];";function eE(e,t,i=!1,r=32,a=!1,s=32,o=!1,n=!1){let u=e[1]*t[1],l=e[0]*t[0],d=i?u:r,h=i?r:u;m.util.assert(h%t[1]==0&&d%t[0]==0&&r%t[1]==0,()=>`tileAHight ${h} must be divisible by workgroupSize[1]${t[1]}, tileAWidth ${d} must be divisible by workgroupSize[0]${t[0]}, tileInner ${r} must be divisible by workgroupSize[1]${t[1]}`);let p=h/t[1],c=d/t[0],f=r/t[1],g=e[1],x=e[0],y=o?`
      let localRow = i32(localId.y);
      let localCol = i32(localId.x);
      let globalRowStart = i32(workgroupId.y) * ${u};
      let globalColStart = i32(workgroupId.x) * ${l};

      // Loop over shared dimension.
      for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        for (var inputRow = localRow; inputRow < ${h}; inputRow = inputRow + ${t[1]}) {
          for (var inputCol = localCol; inputCol < ${d}; inputCol = inputCol + ${t[0]}) {
            ${eT(i)}
          }
        }
        // Load one tile of B into local memory.
        for (var inputRow = localRow; inputRow < ${r}; inputRow = inputRow + ${t[1]}) {
              for (var inputCol = localCol; inputCol < ${l}; inputCol = inputCol + ${t[0]}) {
            mm_Bsub[inputRow][inputCol] = mm_readB(batchB,
              kStart + inputRow,
              globalColStart + inputCol);
          }
        }
        kStart = kStart + ${r};
        workgroupBarrier();

        // Compute acc values for a single thread.
        var BCached : array<f32, ${x}>;
        for (var k = 0; k < ${r}; k++) {
          for (var inner = 0; inner < ${x}; inner++) {
            BCached[inner] = mm_Bsub[k][localCol + inner * ${t[0]}];
          }
          for (var innerRow = 0; innerRow < ${g}; innerRow++) {
            let ACached = ${i?`mm_Asub[k][localRow + innerRow * ${t[1]}];`:`mm_Asub[localRow + innerRow * ${t[1]}][k];`}
            for (var innerCol = 0; innerCol < ${x}; innerCol++) {
              acc[innerRow][innerCol] =
                  fma(ACached, BCached[innerCol], acc[innerRow][innerCol]);
            }
          }
        }
        workgroupBarrier();
      }
      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        let gRow = globalRowStart + localRow + innerRow * ${t[1]};
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          let gCol = globalColStart + localCol + innerCol * ${t[0]};
          mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
        }
      }
      `:`
  let tileRow = i32(localId.y) * ${g};
  let tileCol = i32(localId.x) * ${x};

  let globalRow = i32(globalId.y) * ${g};
  let globalCol = i32(globalId.x) * ${x};
  let globalRowStart = i32(workgroupId.y) * ${u};

  let tileRowA = i32(localId.y) * ${p};
  let tileColA = i32(localId.x) * ${c};
  let tileRowB = i32(localId.y) * ${f};
  // Loop over shared dimension.
  for (var t = 0; t < numTiles; t++) {
    // Load one tile of A into local memory.
    for (var innerRow = 0; innerRow < ${p}; innerRow++) {
      for (var innerCol = 0; innerCol < ${c}; innerCol++) {
        let inputRow = tileRowA + innerRow;
        let inputCol = tileColA + innerCol;
        ${eT(i)}
      }
    }

    // Load one tile of B into local memory.
    for (var innerRow = 0; innerRow < ${f}; innerRow++) {
      for (var innerCol = 0; innerCol < ${x}; innerCol++) {
        let inputRow = tileRowB + innerRow;
        let inputCol = tileCol + innerCol;
        mm_Bsub[inputRow][inputCol] = mm_readB(batchB,
          kStart + inputRow,
          globalCol + innerCol);
      }
    }
    kStart = kStart + ${r};
    workgroupBarrier();

    // Compute acc values for a single thread.
    var BCached : array<f32, ${x}>;
    for (var k = 0; k < ${r}; k++) {
      for (var inner = 0; inner < ${x}; inner++) {
        BCached[inner] = mm_Bsub[k][tileCol + inner];
      }

      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        ${eL(i)}
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          acc[innerRow][innerCol] =
              fma(ACached, BCached[innerCol], acc[innerRow][innerCol]);
        }
      }
    }

    workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < ${g}; innerRow++) {
    for (var innerCol = 0; innerCol < ${x}; innerCol++) {
      mm_write(batch, globalRow + innerRow, globalCol + innerCol,
          acc[innerRow][innerCol]);
    }
  }
  `;return`
    var<workgroup> mm_Asub : array<array<f32, ${d}>, ${h}>;
    var<workgroup> mm_Bsub : array<array<f32, ${l}>, ${r}>;

    ${$()} {
      let batch = ${a?"0":"i32(globalId.z)"};
      let batchA = ${a||!n?"batch":"batch % uniforms.aShape[0]"};
      let batchB = ${a||!n?"batch":"batch % uniforms.bShape[0]"};
      let numTiles = ${a?`${Math.ceil(s/r)}`:`(uniforms.dimInner - 1) / ${r} + 1`};
      var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

      var acc : array<array<f32, ${x}>, ${g}>;

      // Without this initialization strange values show up in acc.
      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          acc[innerRow][innerCol] = 0.0;
        }
      }
      ${y}
    }
  `}let eB=e=>e?`
      mm_readA(batchA, colA, globalRow),
      mm_readA(batchA, colA + 1, globalRow),
      mm_readA(batchA, colA + 2, globalRow),
      mm_readA(batchA, colA + 3, globalRow)
  `:`
      mm_readA(batchA, globalRow, colA),
      mm_readA(batchA, globalRow, colA + 1),
      mm_readA(batchA, globalRow, colA + 2),
      mm_readA(batchA, globalRow, colA + 3)
  `;class eW{constructor(e,t,i=!1,r=!1,a=null,s=null,o=null,n=!1){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=t,this.dispatchLayout={x:[2],y:[1],z:[0]};let u=i?e[1]:e[2];if(this.isVec4=(u%4==0&&!i||t[1]%4==0&&i)&&t[2]%4==0&&!r,this.outputComponent=this.isVec4?4:1,this.isVectorA=1===t[1]&&!i,!this.isVec4&&this.isVectorA)this.elementsPerThread=[1,1,1],this.workgroupSize=[32,1,1];else{let e=B(t[1],u,t[2],i);this.workgroupSize=e.workgroupSize,this.elementsPerThread=e.elementsPerThread}this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread);let l=null!=a,d=null!=o;l&&this.variableNames.push("bias"),d&&this.variableNames.push("preluActivationWeights"),this.sequentialAccessByThreads=n,this.transposeA=i,this.transposeB=r,this.addBias=l,this.activation=s,this.hasPreluActivationWeights=d,[this.fitAOuter,this.fitBOuter,this.fitInner]=this.getShapeFit(t[1],t[2],u),this.shaderKey=`matMulPacked_${this.elementsPerThread}_${i}_${r}_${this.activation}_${this.fitAOuter}_${this.fitBOuter}_${this.fitInner}_${this.isVec4}_${this.isVectorA}_${this.sequentialAccessByThreads}`}getShapeFit(e,t,i){let r=this.workgroupSize[1]*this.elementsPerThread[1],a=this.workgroupSize[0]*this.elementsPerThread[0];return!this.isVec4&&this.isVectorA?this.tileInner=4*this.workgroupSize[0]:this.tileInner=a,[e%r==0,t%a==0,i%this.tileInner==0]}getUserCode(){return`
      ${eP(this.activation,this.hasPreluActivationWeights,this.isVec4)}
      ${eA(this.addBias,this.activation,!1,this.transposeB,this.fitAOuter,this.fitBOuter,this.fitInner,this.isVec4?4:1)}
      ${this.isVec4?e_(this.elementsPerThread,this.workgroupSize,this.transposeA,this.tileInner,!1,null,!0):this.isVectorA?function(e,t=!1){m.util.assert(1===e[1]&&1===e[2],()=>`A linear work group size is required. But got ${e}.`);let i=4*e[0];return`
    var<workgroup> mm_Asub : array<vec4<f32>, ${e[0]}>;

    ${$()} {
      let tileCol = i32(localId.x);
      let globalCol = i32(globalId.x);
      let globalRow = i32(globalId.y);

      let numTiles = (uniforms.dimInner - 1) / ${i} + 1;
      let batch = i32(globalId.z);
      let batchA = batch % uniforms.aShape[0];
      let batchB = batch % uniforms.bShape[0];
      // Without this initialization strange values show up in acc.
      var acc = 0.0;

      // Loop over shared dimension.
      for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        let colA = t * ${i} + tileCol * 4;
        mm_Asub[tileCol] = vec4<f32>(${eB(t)});
        workgroupBarrier();

        // Compute acc values for a single thread.
        for (var k = 0; k < ${i/4}; k++) {
          let rowB = t * ${i} + k * 4;
          let BCached = vec4<f32>(mm_readB(batchB, rowB, globalCol),
                              mm_readB(batchB, rowB + 1, globalCol),
                              mm_readB(batchB, rowB + 2, globalCol),
                              mm_readB(batchB, rowB + 3, globalCol));

          let ACached = mm_Asub[k];
          acc = acc + dot(ACached, BCached);
        }

        workgroupBarrier();
      }

      mm_write(batch, globalRow, globalCol, acc);
    }
  `}(this.workgroupSize,this.transposeA):eE(this.elementsPerThread,this.workgroupSize,this.transposeA,this.tileInner,!1,null,this.sequentialAccessByThreads,!0)}
    `}}class eO{constructor(e,t=!1,i=!1,r=null,a=null,s=null){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[256,1,1],this.outputShape=e,this.dispatchLayout={x:[],y:[1,2],z:[0]},this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize);let o=null!=r,n=null!=s;o&&this.variableNames.push("bias"),n&&this.variableNames.push("preluActivationWeights"),this.transposeA=t,this.transposeB=i,this.addBias=o,this.activation=a,this.hasPreluActivationWeights=n,this.shaderKey=`matMulReduce_${this.activation}_${t}_${i}`}getUserCode(){var e;return`
      ${eP(this.activation,this.hasPreluActivationWeights)}
      ${eA(this.addBias,this.activation,this.transposeA,this.transposeB)}
      ${e=this.workgroupSize[0],`
    var<workgroup> sumValues : array<f32, ${e}>;
    ${$()} {
      let coords = getOutputCoords();
      let batch = coords[0];
      let batchA = batch % uniforms.aShape[0];
      let batchB = batch % uniforms.bShape[0];
      let row = coords[1];
      let col = coords[2];
      var sum = 0.0;
      let Length = uniforms.dimInner;
      for (var k = i32(localId.x); k < Length; k = k + ${e}) {
        let dataA = mm_readA(batchA, row, k);
        let dataB = mm_readB(batchB, k, col);
        sum = sum + dataA * dataB;
      }
      sumValues[localId.x] = sum;
      workgroupBarrier();

      for(var currentSize = ${e/2}u; currentSize > 1u;
          currentSize = currentSize / 2u) {
        if (localId.x < currentSize)
        {
          sumValues[localId.x] = sumValues[localId.x] + sumValues[localId.x + currentSize];
        }
        workgroupBarrier();
      }

      if (localId.x == 0u) {
        sum = sumValues[0] + sumValues[1];
        mm_write(batch, row, col, sum);
      }
    }
  `}
    `}}class eU{constructor(e,t,i,r=!1,a=!1,s=null,o=null,n=null){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[16,8,1],this.outputShape=i,this.dispatchLayout={x:[2],y:[1],z:[0]},this.dispatch=[Math.ceil(i[2]/this.workgroupSize[0]),Math.ceil(i[1]/this.workgroupSize[1]),i[0]];let u=null!=s;u&&this.variableNames.push("bias");let l=null!=n;l&&this.variableNames.push("preluActivationWeights"),this.transposeA=r,this.transposeB=a,this.addBias=u,this.activation=o,this.hasPreluActivationWeights=l,this.shaderKey=`matMulSmallOutputSize_${this.activation}_${r}_${a}`}getUserCode(){return`
      ${eP(this.activation,this.hasPreluActivationWeights)}
      ${eA(this.addBias,this.activation,this.transposeA,this.transposeB)}
      ${function(e){let t=e[1],i=e[0],r=t>i?t:i;return`
  var<workgroup> mm_Asub : array<array<f32, ${r}>, ${t}>;
  var<workgroup> mm_Bsub : array<array<f32, ${i}>, ${r}>;

  // If the output size is small for matrix multiplication, avoid to use vec4
  // and handle some elements per thread to optimally utilize the ALU.
  // Read data from global memory to registers firstly, then store them into
  // shared memory, so it is instruction-Level parallelism for arithmetic
  // operations and others handle IO operations between barrier api, makes ALU
  // and load/store units work simultaneously, could improves the performance.
  ${$()} {
    let tileRow = i32(localId.y);
    let tileCol = i32(localId.x);
    let globalRow = i32(globalId.y);
    let globalCol = i32(globalId.x);
    let batch = i32(globalId.z);
    let batchA = batch % uniforms.aShape[0];
    let batchB = batch % uniforms.bShape[0];

    // uniforms.dimInner should be greater than 0.
    let numTiles = (uniforms.dimInner - 1) / ${r} + 1;
    var acc = 0.0;

    var globalColA = tileCol;
    var globalRowB = 0;
    var regA = mm_readA(batchA, globalRow, globalColA);
    var regB0 = mm_readB(batchB, globalRowB + 2 * tileRow, globalCol);
    var regB1 = mm_readB(batchB, globalRowB + 2 * tileRow + 1, globalCol);
    globalColA = globalColA + ${r};
    globalRowB = globalRowB + ${r};

    for (var t = 0; t < numTiles; t = t + 1) {
      mm_Asub[tileRow][tileCol] = regA;
      mm_Bsub[2 * tileRow][tileCol] = regB0;
      mm_Bsub[2 * tileRow + 1][tileCol] = regB1;

      workgroupBarrier();

      regA = mm_readA(batchA, globalRow, globalColA);
      regB0 = mm_readB(batchB, globalRowB + 2 * tileRow, globalCol);
      regB1 = mm_readB(batchB, globalRowB + 2 * tileRow + 1, globalCol);
      globalColA = globalColA + ${r};
      globalRowB = globalRowB + ${r};

      for (var k = 0; k < ${r}; k = k + 1) {
        acc = acc + mm_Asub[tileRow][k] * mm_Bsub[k][tileCol];
      }
      workgroupBarrier();
    }

    mm_write(batch, globalRow, globalCol, acc);
  }
  `}(this.workgroupSize)}
    `}}class eV{constructor(e,t,i=!1,r=!1){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[8,8,1],this.atomic=!0,this.splitedDimInner=128,m.util.assert(1===e[0],()=>"MatMulSplitKProgram only supports batch = 1."),this.outputShape=e,this.dispatchLayout={x:[2],y:[1],z:[0,3]};let a=(i&&this.outputShape[1]%4==0||!i&&t%4==0)&&this.outputShape[2]%4==0;this.elementsPerThread=[4,4,this.splitedDimInner],this.outputComponent=a?4:1,!a&&(this.outputShape[1]<16&&(this.elementsPerThread[1]=1),this.outputShape[2]<16&&(this.elementsPerThread[0]=1)),this.dispatch=E(this.dispatchLayout,[this.outputShape[0],this.outputShape[1],this.outputShape[2],t],this.workgroupSize,this.elementsPerThread),this.transposeA=i,this.transposeB=r,this.shaderKey=`matMulSplitK_${i}_${r}_${this.elementsPerThread}_${this.outputComponent}`}getUserCode(){let e=this.outputComponent;return`
      ${eN(!1,this.transposeB,!1,!1,!1,e)}
      fn mm_write(batch: i32, row : i32, col : i32, value : ${I(e)}) {
        if (row < uniforms.dimAOuter && col < uniforms.dimBOuter) {
          let coords = vec3<i32>(batch, row, col);
          let flatIndex = getOutputIndexFromCoords(coords);
          // The problem is that we should initialize output to zero before using.
          // Otherwise, the original value will be added to the result.
          for (var i = 0; i < ${e}; i = i + 1) {
            ${S("&result[flatIndex + i]",`${e>1?"value[i]":"value"}`,"float32")}
          }
        }
      }
      ${4===e?e_(this.elementsPerThread,this.workgroupSize,this.transposeA,32,!0,this.splitedDimInner):eE(this.elementsPerThread,this.workgroupSize,this.transposeA,32,!0,this.splitedDimInner)}
    `}}class eM{constructor(e,t=null,i=null,r=null){this.uniforms="",this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.addBias=null!=t,this.hasPreluActivationWeights=null!=r,this.activation=i,this.addBias&&this.variableNames.push("bias"),this.hasPreluActivationWeights&&this.variableNames.push("preluActivationWeights"),this.shaderKey=`biasActivation_${i}`}getUserCode(){return`
    ${eP(this.activation,this.hasPreluActivationWeights)}
    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        var value = getXByOutputIndex(index);
        ${ez(this.addBias,this.activation)}
        setOutputAtIndex(index, value);
      }
    }
    `}}class eG{constructor(e){this.variableNames=[],this.outputShape=[],this.uniforms="value : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="fill"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        setOutputAtIndex(index, uniforms.value);
      }
    }
  `}}function eH(e){let{backend:t,attrs:i}=e,{shape:r,value:a}=i,{dtype:s}=i;if("string"===(s=s||m.util.inferDtype(a))){let e=m.util.getArrayFromDType(s,m.util.sizeFromShape(r));return e.fill(a),t.makeTensorInfo(r,s,e)}{let e=new eG(r);return t.runWebGPUProgram(e,[],s,[{type:"float32",data:[a]}])}}let eX={kernelName:m.Fill,backendName:"webgpu",kernelFunc:eH};function eK(e){let{inputs:t,attrs:i}=e,{x:r}=t,{shape:a}=i,s=m.util.sizeFromShape(r.shape),o=m.util.inferFromImplicitShape(a,s),n=m.util.sizeFromShape(o);return m.util.assert(s===n,()=>`The new shape (${o}) has ${n} elements and the old shape (${r.shape}) has ${s} elements. The new shape and old shape must have the same number of elements.`),e.backend.incRef(r.dataId),{dataId:r.dataId,shape:o,dtype:r.dtype}}let eq={kernelName:m.Reshape,backendName:"webgpu",kernelFunc:eK};function eY({a:e,b:t,transposeA:i,transposeB:r,backend:a,bias:s=null,preluActivationWeights:o=null,leakyreluAlpha:n=0,activation:u=null}){let l,h;let p=e.shape.length,c=t.shape.length,f=i?e.shape[p-2]:e.shape[p-1],g=r?t.shape[c-1]:t.shape[c-2],x=i?e.shape[p-1]:e.shape[p-2],y=r?t.shape[c-2]:t.shape[c-1],w=e.shape.slice(0,-2),b=t.shape.slice(0,-2),C=m.util.sizeFromShape(w),S=m.util.sizeFromShape(b),v=m.broadcast_util.assertAndGetBroadcastShape(e.shape.slice(0,-2),t.shape.slice(0,-2)).concat([x,y]);m.util.assert(f===g,()=>`Error in matMul: inner shapes (${f}) and (${g}) of Tensors with shapes ${e.shape} and ${t.shape} and transposeA=${i} and transposeB=${r} must match.`);let I=i?[C,f,x]:[C,x,f],k=r?[S,y,g]:[S,g,y],R=eK({inputs:{x:e},backend:a,attrs:{shape:I}}),$=eK({inputs:{x:t},backend:a,attrs:{shape:k}}),P=[R,$],z=Math.max(C,S),N=[R,$],A=[{type:"int32",data:[x]},{type:"int32",data:[y]},{type:"int32",data:[f]}],D=[z,x,y],F=(0,m.env)().get("WEBGPU_MATMUL_PROGRAM_TYPE");if(F<0){let e=(0,m.env)().getNumber("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL"),t=e>0?e:a.thresholdToIncreaseWorkgroups,i=z*Math.ceil(x/32)*Math.ceil(y/32);F=i<=t||x<=8&&i<=2*t?z*x*y<=128?d.MatMulReduceProgram:1===z&&g>=2e3?d.MatMulSplitKProgram:d.MatMulSmallOutputSizeProgram:d.MatMulPackedProgram}switch(F){case d.MatMulReduceProgram:l=new eO(D,i,r,s,u,o);break;case d.MatMulSplitKProgram:if(h=eH({backend:a,attrs:{shape:D,value:0,dtype:e.dtype}}),l=new eV(D,g,i,r),s||u){let t=new eM((h=a.runWebGPUProgram(l,N,e.dtype,A,h)).shape,s,u,o),i=null,r=[h];s&&r.push(s),o&&r.push(o),"leakyrelu"===u&&(i=[{type:"float32",data:[n]}],t.uniforms+=" alpha : f32,");let d=a.runWebGPUProgram(t,r,h.dtype,i);P.push(h);let p=eK({inputs:{x:d},backend:a,attrs:{shape:v}});for(let e of(P.push(d),P))a.disposeData(e.dataId);return p}break;case d.MatMulSmallOutputSizeProgram:l=new eU(I,k,D,i,r,s,u,o);break;case d.MatMulPackedProgram:l=new eW(I,D,i,r,s,u,o,a.adapterInfo.isIntel());break;default:throw Error(`Unsupported MatMulProgramType ${F}.`)}s&&N.push(s),o&&N.push(o),"leakyrelu"===u&&(A.push({type:"float32",data:[n]}),l.uniforms+=" alpha : f32,");let _=eK({inputs:{x:h=a.runWebGPUProgram(l,N,e.dtype,A,h)},backend:a,attrs:{shape:v}});for(let e of(P.push(h),P))a.disposeData(e.dataId);return _}let ej={kernelName:m._FusedMatMul,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{a,b:s,bias:o,preluActivationWeights:n}=t,{transposeA:u,transposeB:l,activation:d,leakyreluAlpha:h}=r;return eY({a,b:s,transposeA:u,transposeB:l,backend:i,bias:o,preluActivationWeights:n,leakyreluAlpha:h,activation:d})}};class eQ{constructor(e,t,i){this.variableNames=["AReal","AImag","BReal","BImag"],this.workgroupSize=[128,1,1],this.size=!0,this.outputShape=m.backend_util.assertAndGetBroadcastShape(t,i),this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`binaryOpComplex_${e}`,this.op=e}getUserCode(){let e=el(this.op,!1);return`
      fn binaryOpComplex(
          areal : f32, aimag : f32, breal : f32, bimag : f32) -> f32 {
        ${e}
      }

      ${$("index")} {
        if(index < uniforms.size) {
          let areal = getARealByOutputIndex(index);
          let aimag = getAImagByOutputIndex(index);
          let breal = getBRealByOutputIndex(index);
          let bimag = getBImagByOutputIndex(index);
          setOutputAtIndex(index, binaryOpComplex(areal, aimag, breal, bimag));
        }
      }
    `}}class eZ{constructor(e,t,i){if(this.size=!0,this.variableNames=["A","B"],this.outputShape=m.backend_util.assertAndGetBroadcastShape(t,i),this.dispatchLayout=U(this.outputShape),this.op=e,this.useSharedMemoryWithA=t.length<=1&&i.length>1&&t[0]<128,this.useSharedMemoryWithB=i.length<=1&&t.length>1&&i[0]<128,this.useSharedMemoryWithA||this.useSharedMemoryWithB)this.outputComponent=1,this.variableComponents=[1,1],this.lastDimensionSize=this.useSharedMemoryWithB?i[0]:t[0],this.shaderKey=`binary_${e}_${this.lastDimensionSize}`,this.type="shared",this.workgroupSize=[256,1,1];else{let r=t.length>0&&t[t.length-1]%4==0,a=i.length>0&&i[i.length-1]%4==0;r&&a?(this.outputComponent=4,this.variableComponents=[4,4]):r&&(m.util.isScalarShape(i)||1===i[i.length-1])||a&&(m.util.isScalarShape(t)||1===t[t.length-1])?(this.outputComponent=4,this.variableComponents=r?[4,1]:[1,4]):(this.outputComponent=1,this.variableComponents=[1,1]),this.type="nonshared",this.shaderKey=`binary_${e}_${this.variableComponents}`,this.workgroupSize=[128,1,1]}this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.outputComponent,1,1])}getUserCode(){let e;let t=4===this.outputComponent?"vec4<f32>":"f32",i=`
    fn binaryOperation(a : ${t}, b : ${t}) -> ${t} {
      ${el(this.op,4===this.outputComponent)}
    };
    `;if("shared"===this.type){let t=this.lastDimensionSize>1?`coords[${this.outputShape.length-1}]`:"0",r=this.useSharedMemoryWithB?`let a = getAByOutputIndex(index);
          let b = sharedBuf[${t}];`:`let a = sharedBuf[${t}];
          let b = getBByOutputIndex(index);`;e=`
        ${i}
        var<workgroup> sharedBuf : array<f32, ${this.lastDimensionSize}>;
        ${$("index")} {
          // Fill in the shared memory buffer.
          let localIndex = i32(localId.x);
          if(localIndex < ${this.lastDimensionSize}) {
            sharedBuf[localIndex] = f32(${this.useSharedMemoryWithB?"B":"A"}[localIndex]);
          }
          workgroupBarrier();

          if(index < uniforms.size) {
            let coords = getCoordsFromIndex(index);
            ${r}
            setOutputAtIndex(index, binaryOperation(a, b));
          }
        }
        `}else e=`
       ${i}
       ${$("index")} {
         if (index < uniforms.size) {
           let coords = getCoordsFromIndex(index * ${this.outputComponent});
           let a = ${t}(getAByOutputCoords(coords));
           let b = ${t}(getBByOutputCoords(coords));
           setOutputAtIndex(index, binaryOperation(a, b));
         }
       }
       `;return e}}function eJ(e){let{inputs:t}=e,{x:i}=t;return e.backend.incRef(i.dataId),{dataId:i.dataId,shape:i.shape,dtype:i.dtype}}let e2={kernelName:m.Identity,backendName:"webgpu",kernelFunc:eJ};function e3(e){let{inputs:t,backend:i}=e,{real:r,imag:a}=t,s=i.makeTensorInfo(r.shape,"complex64"),o=i.tensorMap.get(s.dataId),n=eJ({inputs:{x:r},backend:i}),u=eJ({inputs:{x:a},backend:i});return o.complexTensorInfos={real:n,imag:u},s}let e0={kernelName:m.Complex,backendName:"webgpu",kernelFunc:e3};class e1{constructor(e,t,i=""){this.variableNames=["A"],this.size=!0,this.workgroupSize=[128,1,1],this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.op=t,""!==i&&(this.uniforms=i),this.shaderKey=`unary_${t}`}getUserCode(){return`
      fn unaryOperation(a : f32) -> f32 {
        ${e$(this.op,!1)}
      }
      ${$("index")} {
        if (index < uniforms.size) {
          let a = getAByOutputIndex(index);
          setOutputAtIndex(index, unaryOperation(a));
        }
      }
      `}}function e4({opType:e,cpuKernelImpl:t,dtype:i}){return({inputs:r,backend:a})=>{let{x:s}=r,o=i||s.dtype;if(a.shouldExecuteOnCPU([s])&&null!=t){let e=t(a.tensorMap.get(s.dataId).values,o);return a.makeTensorInfo(s.shape,o,e)}let n=new e1(s.shape,e);return a.runWebGPUProgram(n,[s],o)}}function e6({opType:e,cpuKernelImpl:t,supportsComplex:i=!1,dtype:r}){return({inputs:a,backend:s})=>{let{a:o,b:n}=a;if(i&&"complex64"===o.dtype){let t,i;let r=s.tensorMap.get(o.dataId),a=s.tensorMap.get(n.dataId);if(e!==h.MUL)[t,i]=[[r.complexTensorInfos.real,a.complexTensorInfos.real],[r.complexTensorInfos.imag,a.complexTensorInfos.imag]].map(t=>{let[i,r]=t,a={dataId:i.dataId,dtype:i.dtype,shape:o.shape},u={dataId:r.dataId,dtype:r.dtype,shape:n.shape},l=new eZ(e,o.shape,n.shape);return s.runWebGPUProgram(l,[a,u],(0,m.upcastType)(i.dtype,r.dtype))});else{let e=new eQ(h.COMPLEX_MULTIPLY_REAL,o.shape,n.shape),u=new eQ(h.COMPLEX_MULTIPLY_IMAG,o.shape,n.shape),l=[{dataId:r.complexTensorInfos.real.dataId,dtype:r.complexTensorInfos.real.dtype,shape:o.shape},{dataId:r.complexTensorInfos.imag.dataId,dtype:r.complexTensorInfos.imag.dtype,shape:o.shape},{dataId:a.complexTensorInfos.real.dataId,dtype:a.complexTensorInfos.real.dtype,shape:n.shape},{dataId:a.complexTensorInfos.imag.dataId,dtype:a.complexTensorInfos.imag.dtype,shape:n.shape}];t=s.runWebGPUProgram(e,l,"float32"),i=s.runWebGPUProgram(u,l,"float32")}let u=e3({inputs:{real:t,imag:i},backend:s});return s.disposeData(t.dataId),s.disposeData(i.dataId),u}let u=r||(0,m.upcastType)(o.dtype,n.dtype);if(("string"===o.dtype||"string"===n.dtype||s.shouldExecuteOnCPU([o,n]))&&null!=t){let e=s.tensorMap.get(o.dataId).values,i=s.tensorMap.get(n.dataId).values,r="string"===o.dtype?m.backend_util.fromUint8ToStringArray(e):e,a="string"===o.dtype?m.backend_util.fromUint8ToStringArray(i):i,[l,d]=t(o.shape,n.shape,r,a,u);return s.makeTensorInfo(d,u,l)}let l=new eZ(e,o.shape,n.shape);return s.runWebGPUProgram(l,[o,n],u)}}let{addImpl:e5,castImpl:e8,ceilImpl:e7,concatImpl:e9,equalImpl:te,expImpl:tt,expm1Impl:ti,floorImpl:tr,floorDivImpl:ta,gatherNdImpl:ts,gatherV2Impl:to,greaterEqualImpl:tn,greaterImpl:tu,lessEqualImpl:tl,lessImpl:td,logImpl:th,maxImpl:tp,maximumImpl:tc,minimumImpl:tf,multiplyImpl:tm,negImpl:tg,notEqualImpl:tx,prodImpl:ty,rangeImpl:tw,rsqrtImpl:tb,scatterImpl:tC,simpleAbsImpl:tS,sliceImpl:tv,stridedSliceImpl:tI,stringNGramsImpl:tk,subImpl:tR,tileImpl:t$,topKImpl:tP,transposeImpl:tz,uniqueImpl:tN}=i(11163),tA=e4({opType:p.ABS,cpuKernelImpl:tS}),tD={kernelName:m.Abs,backendName:"webgpu",kernelFunc:tA},tF=e4({opType:p.ACOS}),t_={kernelName:m.Acos,backendName:"webgpu",kernelFunc:tF},tT=e4({opType:p.ACOSH}),tL={kernelName:m.Acosh,backendName:"webgpu",kernelFunc:tT},tE=e6({opType:h.ADD,cpuKernelImpl:e5,supportsComplex:!0}),tB={kernelName:m.Add,backendName:"webgpu",kernelFunc:tE};class tW{constructor(e){this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e[0],this.variableNames=e.map((e,t)=>`T${t}`),this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.shaderKey="addN"}getUserCode(){let e=[];this.variableNames.forEach(t=>{e.push(`let v${t} = get${t}ByOutputCoords(coords);`)});let t=this.variableNames.map(e=>`v${e}`).join(" + ");return`
      ${$("index")} {
        for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if (flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            ${e.join("\n        ")}
            setOutputAtIndex(flatIndex, ${t});
          }
        }
      }
    `}}let tO={kernelName:m.AddN,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e;if(1===t.length)return eJ({inputs:{x:t[0]},backend:i});let r=t.map(e=>e.dtype).reduce((e,t)=>(0,m.upcastType)(e,t)),a=new tW(t.map(e=>e.shape));return i.runWebGPUProgram(a,t,r)}};class tU{constructor(e,t){this.variableNames=["A"],this.workgroupSize=[16,16,1];let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[t[r]];this.outputShape=i,this.dispatchLayout={x:[0],y:[1]},this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[1,1,1]),this.shaderKey="transposeShared"}getUserCode(){m.util.assert(this.workgroupSize[0]===this.workgroupSize[1],()=>`Must be a square tile, current tile shape is ${this.workgroupSize[0]} x ${this.workgroupSize[1]}`);let e=this.workgroupSize[0];return`
      var<workgroup> tile : array<array<f32, ${this.workgroupSize[0]+1}>, ${this.workgroupSize[0]}>;
      ${$()} {
        var x = i32(workgroupId.x) * ${e} + i32(localId.x);
        var y = i32(workgroupId.y) * ${e} + i32(localId.y);
        let width = uniforms.outShape[0];
        let height = uniforms.outShape[1];
        if (x < width && y < height) {
          tile[localId.y][localId.x] = f32(A[y * width + x]);
        }
        workgroupBarrier();

        x = i32(workgroupId.y) * ${e} + i32(localId.x);
        y = i32(workgroupId.x) * ${e} + i32(localId.y);
        if (x < height && y < width) {
          setOutputAtIndex((y * height + x), tile[localId.x]
            [localId.y]);
        }
      }
    `}}class tV{constructor(e,t){this.variableNames=["A"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0;let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[t[r]];this.outputShape=i,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.newDim=t,this.shaderKey=`transpose_${t}`}getUserCode(){let e=k(this.outputShape.length),t=tM(this.newDim);return`
      ${$("index")} {
        for(var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if(flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            setOutputAtIndex(flatIndex, A[getIndexFromCoords${this.outputShape.length}D(
              ${e}(${t}), uniforms.aShape)]);
          }
        }
      }
    `}}function tM(e){let t=e.length;if(t>6)throw Error(`Transpose for rank ${t} is not yet supported`);let i=Array(t);for(let t=0;t<e.length;t++)i[e[t]]=`coords.${R(t)}`;return i.join()}function tG(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{perm:s}=r,o=Array(a.shape.length);for(let e=0;e<o.length;e++)o[e]=a.shape[s[e]];if(i.shouldExecuteOnCPU([a])){let e=tz(i.tensorMap.get(a.dataId).values,a.shape,a.dtype,s,o);return i.makeTensorInfo(o,a.dtype,e)}if(2===a.shape.length&&m.util.arraysEqual(s,[1,0])){let e=new tU(a.shape,s);return i.runWebGPUProgram(e,[a],a.dtype)}let n=new tV(a.shape,s);return i.runWebGPUProgram(n,[a],a.dtype)}let tH={kernelName:m.Transpose,backendName:"webgpu",kernelFunc:tG};class tX{constructor(e,t,i){this.variableNames=["x"],this.uniforms="reduceSize : i32,",this.size=!0,this.inputShape=[e.batchSize,e.inSize];let[r]=m.backend_util.computeOutAndReduceShapes(this.inputShape,[1]);this.outputShape=0===r.length?[1]:r,e.inSize>=32768&&i>=512?this.workgroupSize=[512,1,1]:e.inSize>=4096?this.workgroupSize=[256,1,1]:this.workgroupSize=[64,1,1],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,[1,1,1]),this.reduceType=t,this.shaderKey=`reduce_${t}`}getUserCode(){let e="",t="0.0",i=this.workgroupSize[0];"min"===this.reduceType||"max"===this.reduceType?(e=`
         if (isnan(candidate)) {
          bestValue = uniforms.NAN;
         } else if (!isnan(bestValue) && candidate ${"min"===this.reduceType?"<":">"} bestValue)
           {  bestValue = candidate; }`,t="f32(x[offset])"):"sum"===this.reduceType||"mean"===this.reduceType?e=" bestValue = bestValue + candidate; ":"prod"===this.reduceType?(e=" bestValue = bestValue * candidate; ",t="1.0"):"all"===this.reduceType?(e=" bestValue = f32(bestValue >= 1.0 && candidate >= 1.0); ",t="1.0"):"any"===this.reduceType&&(e=" bestValue = f32(bestValue >= 1.0 || candidate >= 1.0); ",t="0.0");let r="mean"===this.reduceType?"setOutputAtIndex(outputIndex, bestValue / f32(uniforms.reduceSize));":"setOutputAtIndex(outputIndex, bestValue);",a=`
         var<workgroup> xBestValues : array<f32, ${i}>;
       `;return`
       fn DIV_CEIL(a : u32, b : u32) -> u32 {
        return ((a - 1u) / b + 1u);
       }

       ${a}
       fn getOffset(outputIndex : i32) -> i32 {
         let outputCoords = getCoordsFromIndex(outputIndex);
         let offset = ${1===this.outputShape.length?"outputCoords":"outputCoords[0]"} * uniforms.reduceSize;
          return offset;
       }
       ${$("index")} {
         let outputIndex = index / ${i};
         let offset = getOffset(outputIndex);
         var bestValue = ${t};
         let Length = uniforms.reduceSize;
         let WorkPerThread = DIV_CEIL(u32(Length), ${i}u);
         for (var k = i32(localId.x); k < Length && outputIndex < uniforms.size;
             k = k + ${i}) {
           let candidate = f32(x[offset + k]);
           ${e}
         }
         xBestValues[localId.x] = bestValue;
         workgroupBarrier();

         var reduceSize = min(u32(Length), ${i}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (localId.x < currentSize) {
            let candidate = xBestValues[localId.x + interval];
            ${e}
            xBestValues[localId.x] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (localId.x == 0u && outputIndex < uniforms.size) {
          ${r}
        }
       }
     `}}let tK={mean:"float32",all:"bool",any:"bool"};function tq(e,t,i,r,a){let s;let o=e.shape.length,n=[],u=m.util.parseAxisParam(t,e.shape),l=u,d=m.backend_util.getAxesPermutation(l,o),h=e;null!=d&&(h=tG({inputs:{x:e},attrs:{perm:d},backend:a}),l=m.backend_util.getInnerMostAxes(l.length,o),n.push(h)),m.backend_util.assertAxesAreInnerMostDims(r,l,o);let[p,c]=m.backend_util.computeOutAndReduceShapes(h.shape,l),f=p;if(i&&(f=m.backend_util.expandShapeToKeepDim(p,u)),("max"===r||"prod"===r)&&a.shouldExecuteOnCPU([h])){let t=a.tensorMap.get(h.dataId).values;switch(r){case"max":let i=tp(t,m.util.sizeFromShape(c),f,e.dtype);s=a.makeTensorInfo(f,e.dtype,i);break;case"prod":let{outVals:o,outShape:n,outDtype:u}=ty(h.shape,h.dtype,t,l);s=a.makeTensorInfo(n,u,o);break;default:throw Error(`${r} CPU implementation is not yet supported.`)}}else{let t=m.util.sizeFromShape(c),i=m.util.sizeFromShape(h.shape)/t,o=tK[r]||(0,m.sumOutType)(e.dtype),u=new tX({windowSize:t,inSize:t,batchSize:i,outSize:1},r,a.device.limits.maxComputeWorkgroupSizeX),l=a.runWebGPUProgram(u,[h],o,[{type:"int32",data:[t]}]);n.push(l),s=eK({inputs:{x:l},attrs:{shape:f},backend:a})}return n.forEach(e=>a.disposeData(e.dataId)),s}let tY={kernelName:m.All,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tq(a,o,s,"all",i)}},tj={kernelName:m.Any,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tq(a,o,s,"any",i)}};class tQ{constructor(e,t,i){this.workgroupSize=[64,1,1],this.variableNames=["x"],this.uniforms="infinityValue : f32,",this.size=!0,this.op="min"===i?"<":">";let[r,a]=m.backend_util.computeOutAndReduceShapes(e,[t]);this.outputShape=0===r.length?[1]:r,this.dispatchLayout=U(this.outputShape),32>m.util.sizeFromShape(a)?(this.type="plain",this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize)):(this.type="shared",this.dispatch=E(this.dispatchLayout,this.outputShape,[1,1,1])),this.inputShape=e,this.shaderKey=`argMinMax_${this.op}_${this.type}`}getUserCode(){let e=this.workgroupSize[0],t=()=>1===this.inputShape.length?"uniforms.xShape":`uniforms.xShape.${R(this.inputShape.length-1)}`,i=()=>{let e="";if(1===this.outputShape.length)1!==this.inputShape.length&&(e+="outputCoords,");else for(let t=0;t<this.outputShape.length;t++)e+=`outputCoords.${R(t)},`;return e};if("shared"!==this.type)return`
      ${$("index")} {
        if (index < uniforms.size) {
          let outputCoords = getCoordsFromIndex(index);
          var bestIndex = 0;
          var bestValue = getX(${i()} 0);
          let reduceLength = ${t()};
          for (var i = 1; i < reduceLength; i++) {
            let candidate = getX(${i()} i);
            if (candidate ${this.op} bestValue) {
              bestValue = candidate;
              bestIndex = i;
            }
          }
          setOutputAtIndexI32(index, bestIndex);
        }
      }
      `;{let r=`
      var<workgroup> xBestIndices : array<i32, ${e}>;
      var<workgroup> xBestValues : array<f32, ${e}>;
    `;return`
      fn DIV_CEIL(a : u32, b : u32) -> u32 {
        return ((a - 1u) / b + 1u);
      }

      ${r}

      ${$("index")} {
        let outputIndex = index / ${e};
        let reduceLength = ${t()};

        var bestIndex = i32(localId.x);
        var bestValue = uniforms.infinityValue;
        let outputCoords = getCoordsFromIndex(outputIndex);
        for (var k = i32(localId.x); k < reduceLength && outputIndex < uniforms.size;
            k = k + ${e}) {
          let candidate = getX(${i()} k);
          if (!isnan(candidate) && candidate ${this.op} bestValue) {
            bestValue = candidate;
            bestIndex = k;
          }
        }
        xBestValues[localId.x] = bestValue;
        xBestIndices[localId.x] = bestIndex;
        workgroupBarrier();

        var reduceSize = min(u32(reduceLength), ${e}u);
        for (var currentSize = reduceSize / 2u; reduceSize > 1u;
            currentSize = reduceSize / 2u) {
          let interval = DIV_CEIL(reduceSize, 2u);
          if (localId.x < currentSize) {
            let candidate = xBestValues[localId.x + interval];
            if (candidate ${this.op} bestValue) {
              bestValue = candidate;
              xBestValues[localId.x] = bestValue;
              xBestIndices[localId.x] = xBestIndices[localId.x + interval];
            }
          }
          reduceSize = interval;
          workgroupBarrier();
        }

        if (localId.x == 0u && outputIndex < uniforms.size) {
          setOutputAtIndexI32(outputIndex, xBestIndices[localId.x]);
        }
      }
    `}}}let tZ={kernelName:m.ArgMax,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s}=r,o=m.util.parseAxisParam(s,a.shape),n=m.backend_util.getAxesPermutation(o,a.shape.length),u=a,l=[];null!=n&&(l.push(u=tG({inputs:{x:a},backend:i,attrs:{perm:n}})),o=m.backend_util.getInnerMostAxes(o.length,u.shape.length)),m.backend_util.assertAxesAreInnerMostDims("argMax",[o[0]],u.shape.length);let d=new tQ(u.shape,o[0],"max"),h=[{type:"float32",data:[Number.NEGATIVE_INFINITY]}],p=i.runWebGPUProgram(d,[u],"int32",h);return l.forEach(e=>i.disposeData(e.dataId)),p}},tJ={kernelName:m.ArgMin,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s}=r,o=m.util.parseAxisParam(s,a.shape),n=m.backend_util.getAxesPermutation(o,a.shape.length),u=a,l=[];null!=n&&(l.push(u=tG({inputs:{x:a},backend:i,attrs:{perm:n}})),o=m.backend_util.getInnerMostAxes(o.length,u.shape.length)),m.backend_util.assertAxesAreInnerMostDims("argMin",[o[0]],u.shape.length);let d=new tQ(u.shape,o[0],"min"),h=[{type:"float32",data:[Number.POSITIVE_INFINITY]}],p=i.runWebGPUProgram(d,[u],"int32",h);return l.forEach(e=>i.disposeData(e.dataId)),p}},t2=e4({opType:p.ASIN}),t3={kernelName:m.Asin,backendName:"webgpu",kernelFunc:t2},t0=e4({opType:p.ASINH}),t1={kernelName:m.Asinh,backendName:"webgpu",kernelFunc:t0},t4=e4({opType:p.ATAN}),t6={kernelName:m.Atan,backendName:"webgpu",kernelFunc:t4},t5=e6({opType:h.ATAN2}),t8={kernelName:m.Atan2,backendName:"webgpu",kernelFunc:t5},t7=e4({opType:p.ATANH}),t9={kernelName:m.Atanh,backendName:"webgpu",kernelFunc:t7};class ie{constructor(e){this.variableNames=["x"],this.uniforms="strides : vec2<i32>,",this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="poolWithFilterSizeEqualsOne"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let batch = coords[0];
          let d = coords[3];

          let xRCCorner = coords.yz * uniforms.strides;
          let xRCorner = xRCCorner.x;
          let xCCorner = xRCCorner.y;

          let value = getX(batch, xRCorner, xCCorner, d);
          setOutputAtIndex(index, value);
        }
      }
    `}}class it{constructor(e,t,i=!1,r=!1,a=!1){if(this.variableNames=["x"],this.uniforms="strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, convDims : vec2<i32>, filterDims : vec2<i32>,",this.workgroupSize=[128,1,1],this.size=!0,"avg"===t&&i)throw Error("Cannot compute positions for average pool.");this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.poolType=t,this.computePositions=i,this.flattenPositions=r,this.includeBatchIndex=a,this.shaderKey=`pool2D_${t}_${i}_${r}_${a}`}getUserCode(){let e;if("avg"===this.poolType)e="resultValue = resultValue + value; count = count + 1.0;";else if(this.computePositions){let t=this.flattenPositions?this.includeBatchIndex?"((batch * uniforms.xShape[1] + xR) * uniforms.xShape[2] + xC) * uniforms.xShape[3] + d":"(xR * uniforms.xShape[2] + xC) * uniforms.xShape[3] + d":"wR * uniforms.filterDims.y + wC";e=`let currMaxValue = mix(value, maxValue, maxValueFound);
      if (value >= currMaxValue) {
        maxValue = value;
        maxValueFound = 1.0;
        maxPosition = ${t};
      }`}else e="resultValue = max(value, resultValue);";let t="resultValue";return"avg"===this.poolType&&(t="resultValue / max(count, 1.0)"),`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
          let batch = coords[0];
          let d = coords[3];
          let xRCCorner = vec2<i32>(coords.yz) * uniforms.strides - uniforms.pads;
          let xRCorner = xRCCorner.x;
          let xCCorner = xRCCorner.y;

          ${this.computePositions?`var maxValue = 0.0;
            var maxValueFound = 0.0;
            var maxPosition = 0;`:`var resultValue = ${"avg"===this.poolType?"0.0":"-1.0 / pow(10.0, -20.0)"};`}

          var count = 0.0;
          for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + uniforms.dilations.x) {
            let xR = xRCorner + wR;

            if (xR < 0 || xR >= uniforms.convDims.x) {
              continue;
            }

            for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + uniforms.dilations.y) {
              let xC = xCCorner + wC;
              if (xC < 0 || xC >= uniforms.convDims.y) {
                continue;
              }

              let value = getX(batch, xR, xC, d);
              ${e}
            }
          }

          ${this.computePositions?"setOutputAtIndexI32(index, maxPosition);":`setOutputAtIndex(index, ${t});`}
        }
      }
    `}}class ii{constructor(e,t,i=!1,r=!1,a=!1){if(this.variableNames=["x"],this.uniforms="strides : vec3<i32>, pads : vec3<i32>, convDims : vec3<i32>, filterDims : vec3<i32>,",this.workgroupSize=[128,1,1],this.size=!0,"avg"===t&&i)throw Error("Cannot compute positions for average pool.");this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.poolType=t,this.computePositions=i,this.flattenPositions=r,this.includeBatchIndex=a,this.shaderKey=`pool3D_${t}_${i}_${r}_${a}`}getUserCode(){let e;if("avg"===this.poolType)e="resultValue += value; count += 1.0;";else if(this.computePositions){let t=this.flattenPositions?this.includeBatchIndex?"(((batch * uniforms.xShape.y + xD) * uniforms.xShape.z + xR) * uniforms.xShape.w + xC) * uniforms.xShape.u + ch":"((xD * uniforms.xShape.z + xR) * uniforms.xShape.w + xC) * uniforms.xShape.u + ch":"wD * uniforms.filterDims.y * uniforms.filterDims.y + wR * uniforms.filterDims.z + wC";e=`let currMaxValue = mix(value, maxValue, maxValueFound);
      if (value >= currMaxValue) {
        maxValue = value;
        maxValueFound = 1.0;
        maxPosition = ${t};
      }`}else e="resultValue = max(value, resultValue);";let t="resultValue";return"avg"===this.poolType&&(t="resultValue / max(count, 1.0)"),`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let batch = coords.x;
          let ch = coords.u;

          let xCorner = vec3<i32>(coords.y, coords.z, coords.w) * uniforms.strides - uniforms.pads;
          let xDCorner = xCorner.x;
          let xRCorner = xCorner.y;
          let xCCorner = xCorner.z;

          ${this.computePositions?`var maxValue = 0.0;
            var maxValueFound = 0.0;
            var maxPosition = 0;`:`var resultValue = ${"avg"===this.poolType?"0.0":"-1.0 / pow(10.0, -20.0)"};`}

          var count = 0.0;
          for (var wD = 0; wD < uniforms.filterDims.x; wD++) {
            let xD = xDCorner + wD;
            if (xD < 0 || xD >= uniforms.convDims.x) {
              continue;
            }

            for (var wR = 0; wR < uniforms.filterDims.y; wR++) {
              let xR = xRCorner + wR;
              if (xR < 0 || xR >= uniforms.convDims.y) {
                continue;
              }

              for (var wC = 0; wC < uniforms.filterDims.z; wC++) {
                let xC = xCCorner + wC;
                if (xC < 0 || xC >= uniforms.convDims.z) {
                  continue;
                }

                let value = getX(batch, xD, xR, xC, ch);
                ${e}
              }
            }
          }

          ${this.computePositions?"setOutputAtIndexI32(index, maxPosition);":`setOutputAtIndex(index, ${t});`}
        }
      }
    `}}function ir(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{reductionIndices:s,keepDims:o}=r;return tq(a,s,o,"max",i)}let ia={kernelName:m.Max,backendName:"webgpu",kernelFunc:ir};function is(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tq(a,o,s,"mean",i)}let io={kernelName:m.Mean,backendName:"webgpu",kernelFunc:is};function iu(e,t,i,r){let a;if(1===t.filterWidth&&1===t.filterHeight&&m.util.arraysEqual(t.inShape,t.outShape))return eJ({inputs:{x:e},backend:r});if(t.filterWidth===t.inWidth&&t.filterHeight===t.inHeight&&1===t.batchSize&&"VALID"===t.padInfo.type){let a;let s=e.shape.length,o=eK({inputs:{x:e},backend:r,attrs:{shape:[e.shape[s-3]*e.shape[s-2],e.shape[s-1]]}});"avg"===i?a=is({inputs:{x:o},backend:r,attrs:{axis:0,keepDims:!1}}):(m.util.assert("max"===i,()=>`Invalid pool type ${i}`),a=ir({inputs:{x:o},backend:r,attrs:{reductionIndices:0,keepDims:!1}}));let n=eK({inputs:{x:a},backend:r,attrs:{shape:t.outShape}});return r.disposeData(o.dataId),r.disposeData(a.dataId),n}let s=[{type:"int32",data:[t.strideHeight,t.strideWidth]}];return 1===t.filterHeight&&1===t.filterWidth?a=new ie(t):("avg"===i?a=new it(t,"avg"):(m.util.assert("max"===i,()=>`Invalid pool type ${i}`),a=new it(t,"max")),s.push({type:"int32",data:[t.padInfo.top,t.padInfo.left]},{type:"int32",data:[t.dilationHeight,t.dilationWidth]},{type:"int32",data:[t.inHeight,t.inWidth]},{type:"int32",data:[t.effectiveFilterHeight,t.effectiveFilterWidth]})),r.runWebGPUProgram(a,[e],e.dtype,s)}let il={kernelName:m.AvgPool,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dimRoundingMode:u}=r,l=m.backend_util.computePool2DInfo(a.shape,s,o,1,n,u);return iu(a,l,"avg",i)}},id={kernelName:m.AvgPool3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dataFormat:u,dimRoundingMode:l}=r,d=m.backend_util.computePool3DInfo(a.shape,s,o,[1,1,1],n,l,u),h=new ii(d,"avg"),p=[{type:"int32",data:[d.strideDepth,d.strideHeight,d.strideWidth]},{type:"int32",data:[d.padInfo.front,d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.inDepth,d.inHeight,d.inWidth]},{type:"int32",data:[d.effectiveFilterDepth,d.effectiveFilterHeight,d.effectiveFilterWidth]}];return i.runWebGPUProgram(h,[a],a.dtype,p)}};class ih{constructor(e){this.variableNames=["dy"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32, avgMultiplier : f32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="avgPool2DBackprop"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d = coords[3];

        let dyRCCorner = vec2<i32>(coords.yz) - uniforms.pads;
        let dyRCorner = dyRCCorner.x;
        let dyCCorner = dyRCCorner.y;

        // Convolve dy(?, ?, d) with pos mask(:, :, d) to get dx(xR, xC, d).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR = wR + uniforms.dilations[0]) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims[1]; wC = wC + uniforms.dilations[1]) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }
            let idyC = i32(dyC);

            let dyValue = getDy(batch, idyR, idyC, d);

            dotProd = dotProd + dyValue * uniforms.avgMultiplier;
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class ip{constructor(e){this.variableNames=["dy"],this.uniforms=`strides : vec3<i32>, pads : vec3<i32>, filterDims : vec3<i32>,
       outDepth : i32, outHeight : i32, outWidth : i32, avgMultiplier : f32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="avgPool3DBackprop"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let ch = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyDCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        // Convolve dy(?, ?, ?, d) with pos mask(:, :, :, ch) to get
        // dx(xD, xR, xC, ch).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wD = 0; wD < uniforms.filterDims[0]; wD++) {
          let dyD = f32(dyDCorner + wD) / f32(uniforms.strides[0]);

          if (dyD < 0.0 || dyD >= f32(uniforms.outDepth) || fract(dyD) > 0.0) {
            continue;
          }
          let idyD = i32(dyD);

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let dyValue = getDy(batch, idyD, idyR, idyC, ch);
              dotProd += dyValue * uniforms.avgMultiplier;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let ic={kernelName:m.AvgPool3DGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t,{filterSize:o,strides:n,pad:u,dimRoundingMode:l}=r,d=m.backend_util.computePool3DInfo(s.shape,o,n,1,u,l),h=new ip(d),p=1/(d.filterDepth*d.filterHeight*d.filterWidth),c=[{type:"int32",data:[d.strideDepth,d.strideHeight,d.strideWidth]},{type:"int32",data:[d.effectiveFilterDepth-1-d.padInfo.front,d.effectiveFilterHeight-1-d.padInfo.top,d.effectiveFilterWidth-1-d.padInfo.left]},{type:"int32",data:[d.effectiveFilterDepth,d.effectiveFilterHeight,d.effectiveFilterWidth]},{type:"int32",data:[d.outDepth]},{type:"int32",data:[d.outHeight]},{type:"int32",data:[d.outWidth]},{type:"float32",data:[p]}];return i.runWebGPUProgram(h,[a],s.dtype,c)}},im={kernelName:m.AvgPoolGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t;G([a,s],"avgPoolGrad");let{filterSize:o,strides:n,pad:u}=r,l=m.backend_util.computePool2DInfo(s.shape,o,n,1,u),d=new ih(l),h=1/(l.filterHeight*l.filterWidth),p=[{type:"int32",data:[l.strideHeight,l.strideWidth]},{type:"int32",data:[l.effectiveFilterHeight-1-l.padInfo.top,l.effectiveFilterWidth-1-l.padInfo.left]},{type:"int32",data:[l.dilationHeight,l.dilationWidth]},{type:"int32",data:[l.effectiveFilterHeight,l.effectiveFilterWidth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"float32",data:[h]}];return i.runWebGPUProgram(d,[a],s.dtype,p)}},ig={kernelName:m.BatchMatMul,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{a,b:s}=t,{transposeA:o,transposeB:n}=r;return eY({a,b:s,transposeA:o,transposeB:n,backend:i})}};class ix{constructor(e,t){this.variableNames=["source"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.rank=t.length,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.start=e,this.uniforms=`start : ${k(e.length)}, `,this.shaderKey="slice"}getUserCode(){let e;let t=k(this.rank),i=function(e){if(1===e)return"sourceLoc";if(e<=6)return iy.slice(0,e).map(e=>`sourceLoc.${e}`).join(",");throw Error(`Slicing for rank ${e} is not yet supported`)}(this.rank);return e=1===this.start.length?this.outputShape.map((e,t)=>"sourceLoc = uniforms.start + coords;"):this.outputShape.map((e,t)=>`sourceLoc.${iy[t]} = uniforms.start.${R(t)} + coords.${iy[t]};`),`
      ${$("index")} {
        if (index < uniforms.size) {
          var sourceLoc : ${t};
          let coords = getCoordsFromIndex(index);
          ${e.join("\n")}
          setOutputAtIndex(index, getSource(${i}));
        }
      }
    `}}let iy=["x","y","z","w","u","v"];function iw(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{begin:s,size:o}=r,[n,u]=m.slice_util.parseSliceParams(a,s,o);if(m.slice_util.assertParamsValid(a,n,u),i.shouldExecuteOnCPU([a])||"string"===a.dtype){let e=tv(i.tensorMap.get(a.dataId).values,n,u,a.shape,a.dtype);return i.makeTensorInfo(u,a.dtype,e)}if(0===m.util.sizeFromShape(u))return i.makeTensorInfo(u,a.dtype,[]);let l=new ix(n,u),d=[{type:"int32",data:n}];return i.runWebGPUProgram(l,[a],a.dtype,d)}let ib={kernelName:m.Slice,backendName:"webgpu",kernelFunc:iw},iC={kernelName:m.BatchToSpaceND,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockShape:s,crops:o}=r;m.util.assert(a.shape.length<=4,()=>"batchToSpaceND for rank > 4 with a WebGPU backend not implemented yet");let n=s.reduce((e,t)=>e*t),u=m.backend_util.getReshaped(a.shape,s,n),l=m.backend_util.getPermuted(u.length,s.length),d=m.backend_util.getReshapedPermuted(a.shape,s,n),h=m.backend_util.getSliceBeginCoords(o,s.length),p=m.backend_util.getSliceSize(d,o,s.length),c=[],f=eK({inputs:{x:a},backend:i,attrs:{shape:u}}),g=tG({inputs:{x:f},backend:i,attrs:{perm:l}}),x=eK({inputs:{x:g},backend:i,attrs:{shape:d}}),y=iw({inputs:{x:x},backend:i,attrs:{begin:h,size:p}});return c.push(f),c.push(g),c.push(x),c.forEach(e=>i.disposeData(e.dataId)),y}},iS=`
  fn bincount_write(index: i32, value: f32) {
    ${S("&result[index]","value","float32")}
  }
`,iv=`
  fn bincount_write(index: i32, value: f32) {
    atomicStore(&result[index], bitcast<i32>(value));
  }
`;class iI{constructor(e,t,i=!1){this.outputShape=[],this.variableNames=["x"],this.uniforms="binCountSize : i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.hasWeights=!0,this.binaryOutput=!1,this.outputShape=e,this.rank=e.length,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.binaryOutput=i,i&&(this.atomic=!1),this.hasWeights=t,this.hasWeights&&this.variableNames.push("w"),this.shaderKey=`bincount_${this.hasWeights}_${this.binaryOutput}_${this.rank}`}getUserCode(){return`
    ${this.binaryOutput?iv:iS}
  ${$("index")} {
    ${1===this.rank?`if (index < uniforms.xShape) {
      let indexVal = i32(getX(index));
      if (indexVal < uniforms.binCountSize) {
        let value = ${this.binaryOutput?1:this.hasWeights?"getW(index)":"1."};
        bincount_write(indexVal, value);
      }
    }`:`let coord = getCoordsFromIndex(index);
    if (coordsInBounds2D(coord, uniforms.xShape)) {
      let indexVal = i32(getX(coord[0], coord[1]));
      if (indexVal < uniforms.binCountSize) {
        let value = ${this.binaryOutput?1:this.hasWeights?"getW(coord[0], coord[1])":"1."};
        bincount_write(coord.x * uniforms.binCountSize + indexVal, value);
      }
    }`}
  }
  `}}let ik={kernelName:m.Bincount,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,weights:s}=t,{size:o}=r,n=m.util.sizeFromShape(a.shape),u=m.util.sizeFromShape(s.shape)>0,l=s.dtype,d=eH({backend:i,attrs:{shape:[o],value:0,dtype:l}}),h=new iI([n],u),p=[{type:"int32",data:[o]}],c=u?[a,s]:[a];return i.runWebGPUProgram(h,c,l,p,d)}};class iR{constructor(e){this.outputShape=[],this.variableNames=["s0","s1"],this.uniforms="s0Size : i32, s1Size : i32, ",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="broadcastArgs"}getUserCode(){return`
  ${$("index")} {
    if (index < uniforms.size) {
      var s0 = 1.0;
      var s1 = 1.0;
      let indexS0 = index - uniforms.size + uniforms.s0Size;
      let indexS1 = index - uniforms.size + uniforms.s1Size;
      if (indexS0 >= 0) {
        s0 = getS0(indexS0);
      }
      if (indexS1 >= 0) {
        s1 = getS1(indexS1);
      }

      if (s0 == 1.0) {
        setOutputAtIndex(index, s1);
      } else if (s1 == 1.0) {
        setOutputAtIndex(index, s0);
      } else if (s0 != s1) {
        setOutputAtIndex(index, uniforms.NAN);
      } else {
        setOutputAtIndex(index, s0);
      }
    }
  }
  `}}let i$={kernelName:m.BroadcastArgs,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{s0:r,s1:a}=t;if(i.shouldExecuteOnCPU([r,a])){let e=i.tensorMap.get(r.dataId),t=i.tensorMap.get(a.dataId),s=e.values,o=t.values,n=m.backend_util.assertAndGetBroadcastShape(Array.from(s),Array.from(o));return i.makeTensorInfo([n.length],"int32",Int32Array.from(n))}let s=m.util.sizeFromShape(r.shape),o=m.util.sizeFromShape(a.shape),n=new iR(Math.max(s,o)),u=[{type:"int32",data:[s]},{type:"int32",data:[o]}];return i.runWebGPUProgram(n,[r,a],"int32",u)}},iP=e6({opType:h.NOT_EQUAL,dtype:"bool",cpuKernelImpl:tx}),iz={kernelName:m.NotEqual,backendName:"webgpu",kernelFunc:iP};function iN(e){let{inputs:t,backend:i}=e,{input:r}=t;return eJ({inputs:{x:i.tensorMap.get(r.dataId).complexTensorInfos.real},backend:i})}let iA={kernelName:m.Real,backendName:"webgpu",kernelFunc:iN},iD={kernelName:m.Cast,backendName:"webgpu",kernelFunc:function e(t){let{inputs:i,backend:r,attrs:a}=t,{x:s}=i,{dtype:o}=a;if("complex64"===o){if("complex64"===s.dtype)return eJ({inputs:{x:s},backend:r});let t=m.zeros(s.shape),i=e({inputs:{x:s},backend:r,attrs:{dtype:"float32"}}),a=e3({inputs:{real:i,imag:t},backend:r});return t.dispose(),r.disposeData(i.dataId),a}if("complex64"===s.dtype){let t=iN({inputs:{input:s},backend:r}),i=e({inputs:{x:t},backend:r,attrs:{dtype:o}});return r.disposeData(t.dataId),i}if(!m.util.hasEncodingLoss(s.dtype,o)){let e=eJ({inputs:{x:s},backend:r});return{dataId:e.dataId,shape:e.shape,dtype:o}}if(r.shouldExecuteOnCPU([s])){let[e,t,i]=e8(r.tensorMap.get(s.dataId).values,s.shape,s.dtype,o);return r.makeTensorInfo(e,t,i)}if("int32"===o)return function(e,t){let i=new e1(e.shape,p.TO_INT),r=t.runWebGPUProgram(i,[e],"int32");return{dataId:r.dataId,shape:r.shape,dtype:r.dtype}}(s,r);if("bool"===o){let e=r.makeTensorInfo([],"bool",m.util.getTypedArrayFromDType("bool",1)),t=iP({inputs:{a:s,b:e},backend:r});return r.disposeData(e.dataId),t}throw Error(`Error in Cast: failed to cast ${s.dtype} to ${o}`)}},iF=e4({opType:p.CEIL,cpuKernelImpl:e7}),i_={kernelName:m.Ceil,backendName:"webgpu",kernelFunc:iF};class iT{constructor(e){this.variableNames=["A"],this.uniforms="minVal : f32, maxVal : f32,",this.workPerThread=4,this.workgroupSize=[64,1,1],this.outputComponent=4,this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.shaderKey="clipVec4"}getUserCode(){return`
      ${$("index")} {
        if(index < uniforms.size) {
          let value = getAByOutputIndex(index);
          var clampedValue = clamp(
              value, vec4<f32>(uniforms.minVal), vec4<f32>(uniforms.maxVal));
          clampedValue = select(clampedValue, value, isnanVec4(value));
          setOutputAtIndex(index, clampedValue);
        }
      }
    `}}class iL{constructor(e){this.variableNames=["A"],this.uniforms="minVal : f32, maxVal : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="clip"}getUserCode(){return`
      ${$("index")} {
        if(index < uniforms.size) {
          let value = getAByOutputIndex(index);
          if (isnan(value)) {
            setOutputAtIndex(index, value);
            return;
          }
          setOutputAtIndex(index, clamp(value, uniforms.minVal, uniforms.maxVal));
        }
      }
    `}}let iE={kernelName:m.ClipByValue,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{clipValueMin:o,clipValueMax:n}=a;return t=m.util.sizeFromShape(s.shape)%4==0?new iT(s.shape):new iL(s.shape),r.runWebGPUProgram(t,[s],s.dtype,[{type:"float32",data:[o]},{type:"float32",data:[n]}])}};class iB{constructor(e){this.outputShape=[],this.variableNames=["real","imag"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="complexAbs"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        let re = abs(getRealByOutputIndex(index));
        let im = abs(getImagByOutputIndex(index));
        let mx = max(re, im);

        // The length function in wgsl may be not underflow-safe on some GPUs.
        // So the safe solution is to ensure underflow-safety in all cases.
        setOutputAtIndex(index, select(mx * length(vec2<f32>(1, min(re, im)/mx)), 0.0, mx == 0.0));
      }
    }
  `}}function iW(e,t){return{dataId:t.dataId,dtype:t.dtype,shape:e.shape}}let iO={kernelName:m.ComplexAbs,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t,a=i.tensorMap.get(r.dataId),s=new iB(r.shape),o=[iW(r,a.complexTensorInfos.real),iW(r,a.complexTensorInfos.imag)];return i.runWebGPUProgram(s,o,o[0].dtype)}};class iU{constructor(e){this.uniforms="",this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=m.backend_util.computeOutShape(e,1),this.variableNames=e.map((e,t)=>`T${t}`),this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.offsetLength=e.length-1;for(let e=0;e<this.offsetLength;e++)this.uniforms+=`offset${e} : i32,`;this.shaderKey="concat"}getUserCode(){let e=[];if(this.offsetLength>0){e.push("if (yC < uniforms.offset0){ setOutputAtCoords(coords.x, coords.y, getT0(yR, yC)); }");for(let t=1;t<this.offsetLength;t++)e.push(`else if (yC < uniforms.offset${[t]}){ setOutputAtCoords(coords.x, coords.y, getT${t}(yR, yC - uniforms.offset${t-1})); }`);let t=this.offsetLength,i=this.offsetLength-1;e.push(`else { setOutputAtCoords(coords.x, coords.y, getT${t}(yR, yC - uniforms.offset${i})); }`)}else e.push("setOutputAtCoords(coords.x, coords.y, getT0(yR, yC));");return`
      ${$("index")} {
        for(var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if(flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            let yR = coords.x;
            let yC = coords.y;

            ${e.join("\n        ")}
          }
        }
      }
    `}}function iV(e){let{inputs:t,backend:i}=e,{input:r}=t;return eJ({inputs:{x:i.tensorMap.get(r.dataId).complexTensorInfos.imag},backend:i})}let iM={kernelName:m.Imag,backendName:"webgpu",kernelFunc:iV};function iG(e){let{inputs:t,backend:i,attrs:r}=e,{axis:a}=r,s=m.util.parseAxisParam(a,t[0].shape)[0],o=t.map(e=>e.shape);m.backend_util.assertParamsConsistent(o,s);let n=m.backend_util.computeOutShape(t.map(e=>e.shape),s);if(0===m.util.sizeFromShape(n))return i.makeTensorInfo(n,t[0].dtype,[]);let u=t.filter(e=>m.util.sizeFromShape(e.shape)>0);return 1===u.length?eJ({inputs:{x:u[0]},backend:i}):function e(t,i,r){let a=t[0].dtype;if("complex64"===a){let a=t.map(e=>iN({inputs:{input:e},backend:r})),s=t.map(e=>iV({inputs:{input:e},backend:r})),o=e(a,i,r),n=e(s,i,r),u=e3({inputs:{real:o,imag:n},backend:r});return a.forEach(e=>r.disposeData(e.dataId)),s.forEach(e=>r.disposeData(e.dataId)),r.disposeData(o.dataId),r.disposeData(n.dataId),u}let s=r.shouldExecuteOnCPU(t);if("string"===a&&(s=!0),s){let e=t.map(e=>{let t=m.util.sizeFromShape(e.shape.slice(i));return eK({inputs:{x:e},backend:r,attrs:{shape:[-1,t]}})}),s=e9(e.map(e=>({vals:r.readSync(e.dataId),shape:e.shape})),m.backend_util.computeOutShape(e.map(e=>e.shape),1),a,1===e[0].shape[0]),o=m.backend_util.computeOutShape(t.map(e=>e.shape),i),n=r.makeTensorInfo(o,a,s);return e.forEach(e=>r.disposeData(e.dataId)),n}let o=r.device.limits.maxStorageBuffersPerShaderStage-1;if(t.length>o){let a=[];for(let s=0;s<t.length;s+=o){let n=t.slice(s,s+o);a.push(e(n,i,r))}let s=e(a,i,r);for(let e of a)r.disposeData(e.dataId);return s}let{tensors2D:n,outShape:u}=function(e,t,i){let r=m.backend_util.computeOutShape(e.map(e=>e.shape),t);return{tensors2D:e.map(e=>eK({inputs:{x:e},backend:i,attrs:{shape:[m.util.sizeFromShape(e.shape.slice(0,t)),m.util.sizeFromShape(e.shape.slice(t))]}})),outShape:r}}(t,i,r),l=n.map(e=>e.shape),d=new iU(l),h=[],p=Array(l.length-1);if(p.length>0){p[0]=l[0][1],h.push({type:"int32",data:[p[0]]});for(let e=1;e<p.length;e++)p[e]=p[e-1]+l[e][1],h.push({type:"int32",data:[p[e]]})}let c=r.runWebGPUProgram(d,n,n[0].dtype,h);n.forEach(e=>r.disposeData(e.dataId));let f=eK({inputs:{x:c},backend:r,attrs:{shape:u}});return r.disposeData(c.dataId),f}(u,s,i)}let iH={kernelName:m.Concat,backendName:"webgpu",kernelFunc:iG};class iX{constructor(e,t,i,r,a=!1,s=null,o=!1,n=!1){this.variableNames=["x","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, dilations : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=e.outShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.isVec4=((e.inChannels%4==0||e.inChannels%3==0)&&this.isChannelsLast||e.outWidth%4==0&&!this.isChannelsLast)&&e.outChannels%4==0,this.dispatchLayout=this.isChannelsLast?{x:[3],y:[1,2],z:[0]}:{x:[2,3],y:[1],z:[0]},this.workgroupSize=W(this.dispatchLayout,this.outputShape,this.isVec4),this.elementsPerThread=O(this.dispatchLayout,this.outputShape,this.isVec4),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread),this.isVec4?(this.outputComponent=4,this.isChannelsLast&&e.inChannels%4!=0?(this.innerElementSize=3,this.variableComponents=[1,4]):(this.innerElementSize=4,this.variableComponents=[4,4]),a&&(this.variableNames.push("bias"),this.variableComponents.push(4)),o&&(this.variableNames.push("preluActivationWeights"),this.variableComponents.push(4))):(this.innerElementSize=this.elementsPerThread[0],a&&this.variableNames.push("bias"),o&&this.variableNames.push("preluActivationWeights")),this.sequentialAccessByThreads=n,this.addBias=a,this.activation=s,this.hasPreluActivationWeights=o,this.tileAOuter=this.workgroupSize[1]*this.elementsPerThread[1],this.tileBOuter=this.workgroupSize[0]*this.elementsPerThread[0],this.tileInner=Math.max(this.workgroupSize[0]*this.innerElementSize,this.workgroupSize[1]),this.fitAOuter=t%this.tileAOuter==0,this.fitBOuter=i%this.tileBOuter==0,this.fitInner=r%this.tileInner==0,this.shaderKey=`conv2DMM_${this.elementsPerThread}_${this.activation}}_${this.fitAOuter}_${this.fitBOuter}_${this.fitInner}_${this.isVec4}_${this.innerElementSize}_${this.isChannelsLast}_${this.sequentialAccessByThreads}`}getUserCode(){let e=this.isVec4?e_(this.elementsPerThread,this.workgroupSize,!this.isChannelsLast,this.tileInner):eE(this.elementsPerThread,this.workgroupSize,!this.isChannelsLast,this.tileInner,!1,null,this.sequentialAccessByThreads),t=this.isVec4?[this.innerElementSize,4,4]:[1,1,1];return`
    ${function(e,t,i,r,a=!1,s=null,o=!1,n=4,u=4,l=4){let d=e?`
      let coord = vec4<i32>(batch, xRow, xCol, xCh);
      `:`
      let coord = vec4<i32>(batch, xCh, xRow, xCol);
      `,h=e?`
      let coords = vec4<i32>(
        batch,
        row / outWidth,
        row % outWidth,
        col);
      `:`
      let coords = vec4<i32>(
        batch,
        row,
        col / outWidth,
        col % outWidth);
      `,p=e?"row":"col",c=e?"col":"row",f=`
      let inChannels = uniforms.wShape[2];
      let outWidth = ${e?"uniforms.outShape[2]":"uniforms.outShape[3]"};
      let outRow = ${p} / outWidth;
      let outCol = ${p} % outWidth;

      let WRow = ${c} / (uniforms.filterDims[1] * inChannels);
      let WCol = ${c} / inChannels % uniforms.filterDims[1];
      let xRow = outRow * uniforms.strides[0] + uniforms.dilations[0] * WRow - uniforms.pads[0];
      let xCol = outCol * uniforms.strides[1] + uniforms.dilations[1] * WCol - uniforms.pads[1];
      let xCh = ${c} % inChannels;
      var resData = ${I(n)}(0.0);
      // The bounds checking is always needed since we use it to pad zero for
      // the 'same' padding type.
      if (xRow >= 0 && xRow < ${e?"uniforms.xShape[1]":"uniforms.xShape[2]"} && xCol >= 0 && xCol < ${e?"uniforms.xShape[2]":"uniforms.xShape[3]"}) {
        ${d}
        let xIndex = getIndexFromCoords4D(coord, uniforms.xShape);
        ${(e=>{switch(e){case 1:return"resData = f32(x[xIndex]);";case 3:return"resData = vec3<f32>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);";case 4:return"resData = vec4<f32>(x[xIndex / 4]);";default:throw Error(`innerElementSize ${e} is not supported.`)}})(n)}
      }
      return resData;`,m=e?t&&r?`
      ${f}`:`
      if (row < uniforms.dimAOuter && col < uniforms.dimInner) {
        ${f}
      }
      return ${I(n)}(0.0);`:r&&i?`
      ${f}`:`
      if (row < uniforms.dimInner && col < uniforms.dimBOuter) {
        ${f}
      }
      return ${I(n)}(0.0);`,g=`${(e=>{switch(e){case 1:return"return f32(W[row * uniforms.wShape[3] + col]);";case 4:return"return vec4<f32>(W[(row * uniforms.wShape[3] + col) / 4]);";default:throw Error(`innerElementSize ${e} is not supported.`)}})(u)}`,x=I(l),y=e?I(n):I(u),w=e?I(u):I(n);return`
      ${eP(s,o,4===l,4)}
      fn mm_readA(batch: i32, row : i32, col : i32) -> ${y} {
        ${e?m:g}
      }

      fn mm_readB(batch: i32, row : i32, col : i32) -> ${w} {
        ${e?g:m}
      }

      fn mm_write(batch: i32, row : i32, col : i32, valueIn : ${x}) {
        if (row < uniforms.dimAOuter && col < uniforms.dimBOuter)
        {
        var value = valueIn;
        let outWidth = ${e?"uniforms.outShape[2]":"uniforms.outShape[3]"};
        ${h}
        ${ez(a,s)}
        setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }`}(this.isChannelsLast,this.fitAOuter,this.fitBOuter,this.fitInner,this.addBias,this.activation,this.hasPreluActivationWeights,t[0],t[1],t[2])}
    ${e}
  `}}class iK{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>,",this.workgroupSize=[4,4,8],this.outputShape=e.outShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.dispatchLayout=this.isChannelsLast?{x:[2],y:[1],z:[0,3]}:{x:[3],y:[2],z:[0,1]},this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.addBias=t,this.activation=i,this.hasPreluActivationWeights=r,t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.shaderKey=`conv2dnaive_${this.activation}_${this.isChannelsLast}`}getUserCode(){return`
       ${eP(this.activation,this.hasPreluActivationWeights,!1,4)}
       fn readInp(batch : i32, row : i32, col : i32, chan : i32) -> f32{
         let coords = vec4<i32>(batch, row, col, chan);
         if (coordsInBounds4D(coords, uniforms.xShape)) {
           return  getX(batch, row, col, chan);
         } else {
          return 0.0;
         }
       }
       fn readFilt(row : i32, col : i32, xChannel : i32, outChannel : i32) -> f32{
         let coords = vec4<i32>(row, col, xChannel, outChannel);
         if(coordsInBounds4D(coords, uniforms.wShape)) {
           return getW(row, col, xChannel, outChannel);
          } else {
            return 0.0;
          }
       }
       fn writeResult(batch : i32, row : i32, col : i32, chan : i32, valueIn : f32) {
         let coords = ${this.isChannelsLast?"vec4<i32>(batch, row, col, chan);":"vec4<i32>(batch, chan, row, col);"}
         if (coordsInBounds4D(coords, uniforms.outShape)) {
           var value = valueIn;
           ${ez(this.addBias,this.activation)}
           setOutputAtCoords(coords.x, coords.y, coords.z, coords.w, value);
         }
       }
       ${$("index")} {
         let coords = getOutputCoords();
         let batch = coords[0];
         let outChannel = ${this.isChannelsLast?"coords[3];":"coords[1];"}
         let outRow = ${this.isChannelsLast?"coords[1];":"coords[2];"}
         let outCol = ${this.isChannelsLast?"coords[2];":"coords[3];"}
         var acc : f32 = 0.0;
         for (var row = 0; row < uniforms.filterDims[0]; row = row + 1) {
           for (var col = 0; col < uniforms.filterDims[1]; col = col + 1) {
             let xRow = outRow * uniforms.strides[0] + uniforms.dilations[0] * row - uniforms.pads[0];
             let xCol = outCol * uniforms.strides[1] + uniforms.dilations[1] * col - uniforms.pads[1];
             for (var xChannel = 0; xChannel < ${this.isChannelsLast?"uniforms.xShape[3];":"uniforms.xShape[1];"} xChannel = xChannel + 1) {
               ${this.isChannelsLast?"let v = readInp(batch, xRow, xCol, xChannel);":"let v = readInp(batch, xChannel, xRow, xCol);"}
               let f = readFilt(row, col, xChannel, outChannel);
               acc = acc + v * f;
             }
           }
         }
         writeResult(batch, outRow, outCol, outChannel, acc);
       }
     `}}class iq{constructor(e,t){this.variableNames=["x"],this.uniforms=`pads : vec2<i32>, strides : vec2<i32>, dilations : vec2<i32>, outWidth : i32, itemsPerBlockRow : i32,
       inChannels : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast=t,this.shaderKey=`im2col_${this.isChannelsLast}`}getUserCode(){let e=this.isChannelsLast?1:2,t=this.isChannelsLast?2:3,i=this.isChannelsLast?"coords[1]":"coords[2]",r=this.isChannelsLast?"coords[2]":"coords[1]",a=this.isChannelsLast?"getX(batch, xRow, xCol, ch)":"getX(batch, ch, xRow, xCol)";return`
    ${$("index")} {
      let coords = getCoordsFromIndex(index);
      if(index < uniforms.size) {
        let batch = coords[0];
        let row = ${i};
        let col = ${r};
        let offsetY = (row / uniforms.outWidth) * uniforms.strides[0] - uniforms.pads[0];
        let xRow = offsetY + uniforms.dilations[0] * (col / uniforms.itemsPerBlockRow);
        var value = 0.0;
        if(xRow < uniforms.xShape[${e}] && xRow >= 0) {
          let offsetX = (row % uniforms.outWidth) * uniforms.strides[1] -
              uniforms.pads[1];
          let xCol = offsetX + uniforms.dilations[1] * ((col %
              uniforms.itemsPerBlockRow) / uniforms.inChannels);
          let ch = col % uniforms.inChannels;
          if(xCol < uniforms.xShape[${t}] && xCol >= 0) {
            value = ${a};
          }
        }
        setOutputAtIndex(index, value);
      }
    }
   `}}function iY(e,t){let i=e.length;return i>=3?t?[...e.slice(0,-3),e[i-3]*e[i-2],e[i-1]]:[...e.slice(0,-3),e[i-3],e[i-2]*e[i-1]]:!t&&1===i&&e[0]>1?[e[0],1]:null}function ij({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let u;let l=null!=a,d=null!=s,h="channelsLast"===i.dataFormat,p=h&&i.filterHeight===i.inHeight&&i.filterWidth===i.inWidth&&"VALID"===i.padInfo.type,c=(0,m.env)().getBool("WEBGPU_USE_NAIVE_CONV2D_DEBUG");if(!c&&(p||1===i.filterHeight&&1===i.filterWidth&&1===i.dilationHeight&&1===i.dilationWidth&&1===i.strideHeight&&1===i.strideWidth&&("SAME"===i.padInfo.type||"VALID"===i.padInfo.type)))return function({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let u,l;let d="channelsLast"===i.dataFormat,h=d&&i.filterHeight===i.inHeight&&i.filterWidth===i.inWidth&&"VALID"===i.padInfo.type,p=[];if(h){let a=i.inHeight*i.inWidth*i.inChannels;u=eK({inputs:{x:e},backend:r,attrs:{shape:[1,i.batchSize,a]}}),l=eK({inputs:{x:t},backend:r,attrs:{shape:[1,a,i.outChannels]}})}else u=eK({inputs:{x:e},backend:r,attrs:{shape:d?[i.batchSize,i.inHeight*i.inWidth,i.inChannels]:[i.batchSize,i.inChannels,i.inHeight*i.inWidth]}}),l=eK({inputs:{x:t},backend:r,attrs:{shape:[1,i.inChannels,i.outChannels]}});if(p.push(u),p.push(l),null!=s){let e=iY(s.shape,d);null!=e&&(s=eK({inputs:{x:s},backend:r,attrs:{shape:e}}),p.push(s))}if(null!=a){let e=iY(a.shape,d);null!=e&&(a=eK({inputs:{x:a},backend:r,attrs:{shape:e}}),p.push(a))}let c=eY({a:d?u:l,b:d?l:u,transposeA:!d,transposeB:!1,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o}),f=eK({inputs:{x:c},backend:r,attrs:{shape:i.outShape}});for(let e of(p.push(c),p))r.disposeData(e.dataId);return f}({x:e,filter:t,convInfo:i,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o});let f=(0,m.env)().getNumber("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL"),g=f>-1?f:r.thresholdToIncreaseWorkgroups,x=i.batchSize*Math.ceil(i.outHeight*i.outWidth/32)*Math.ceil(i.outChannels/32);if((0,m.env)().getBool("WEBGPU_CONV_SEPARATE_IM2COL_SHADER")||x<=g)return function({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let{filterWidth:u,filterHeight:l,inChannels:d,strideWidth:h,strideHeight:p,padInfo:c,outWidth:f,outHeight:m,dilationWidth:g,dilationHeight:x,dataFormat:y}=i,w="channelsLast"===y,b=u*l*d,C=m*f,S=new iq(w?[i.batchSize,C,b]:[i.batchSize,b,C],w),v=[{type:"int32",data:[c.top,c.left]},{type:"int32",data:[p,h]},{type:"int32",data:[x,g]},{type:"int32",data:[f]},{type:"int32",data:[d*u]},{type:"int32",data:[d]}],I=r.runWebGPUProgram(S,[e],e.dtype,v),k=[];k.push(I);let R=eK({inputs:{x:t},backend:r,attrs:{shape:[1,b,-1]}});if(k.push(R),null!=s){let e=iY(s.shape,w);null!=e&&(s=eK({inputs:{x:s},backend:r,attrs:{shape:e}}),k.push(s))}if(null!=a){let e=iY(a.shape,w);null!=e&&(a=eK({inputs:{x:a},backend:r,attrs:{shape:e}}),k.push(a))}let $=eY({a:w?I:R,b:w?R:I,transposeA:!w,transposeB:!1,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o}),P=eK({inputs:{x:$},backend:r,attrs:{shape:i.outShape}});for(let e of(k.push($),k))r.disposeData(e.dataId);return P}({x:e,filter:t,convInfo:i,backend:r,bias:a,preluActivationWeights:s,leakyreluAlpha:o,activation:n});let y=[i.padInfo.top,i.padInfo.left],w=[{type:"int32",data:[i.filterHeight,i.filterWidth]},{type:"int32",data:[...y]},{type:"int32",data:[i.strideHeight,i.strideWidth]},{type:"int32",data:[i.dilationHeight,i.dilationWidth]}];if(c)u=new iK(i,l,n,d);else{let e=h?i.outHeight*i.outWidth:i.outChannels,t=h?i.outChannels:i.outHeight*i.outWidth,a=i.filterHeight*i.filterWidth*i.inChannels;w.push({type:"int32",data:[e]},{type:"int32",data:[t]},{type:"int32",data:[a]}),u=new iX(i,e,t,a,l,n,d,r.adapterInfo.isIntel())}let b=[],C=[e,t];l&&(h||1!==a.shape.length||b.push(a=eK({inputs:{x:a},backend:r,attrs:{shape:[a.shape[0],1,1]}})),C.push(a)),d&&(h||1!==s.shape.length||b.push(s=eK({inputs:{x:s},backend:r,attrs:{shape:[s.shape[0],1,1]}})),C.push(s)),"leakyrelu"===n&&(w.push({type:"float32",data:[o]}),u.uniforms+=" alpha : f32,");let S=r.runWebGPUProgram(u,C,e.dtype,w);for(let e of b)r.disposeData(e.dataId);return S}let iQ={kernelName:m.Conv2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,attrs:i,backend:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dataFormat:u,dilations:l,dimRoundingMode:d}=i,h=m.backend_util.convertConv2DDataFormat(u),p=m.backend_util.computeConv2DInfo(a.shape,s.shape,o,l,n,d,!1,h);return ij({x:a,filter:s,convInfo:p,backend:r})}};class iZ{constructor(e){this.variableNames=["dy","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, outBackprop : vec4<i32>,",this.workgroupSize=[64,1,1],this.size=!1,this.isVec4=!1,this.workPerThread=1,this.outputShape=e.inShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.isVec4=this.isChannelsLast&&e.outChannels%4==0&&e.inChannels%4==0,this.isVec4?(this.workPerThread=2,this.outputComponent=4,this.workgroupSize=[4,4,4],this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[4,this.workPerThread,1])):(this.size=!0,this.workPerThread=1,this.workgroupSize=[64,1,1],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize)),this.shaderKey=`conv2DDerInput_${this.isChannelsLast}_${this.isVec4}_${this.workPerThread}`}getUserCode(){let e=this.isChannelsLast?1:2,t=this.isChannelsLast?2:3,i=this.isChannelsLast?3:1,r=`
    ${$()} {
      let batch = i32(globalId.z) / uniforms.outShape[1];
      let r = i32(globalId.z) % uniforms.outShape[1];
      let c = i32(globalId.y) * ${this.workPerThread};
      let d1 = i32(globalId.x) * 4;

      let dyCorner = vec2<i32>(r, c) - uniforms.pads;

      // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
      // ? = to be determined. : = across all values in that axis.
      var dotProd: array<vec4<f32>, ${this.workPerThread}>;
      for (var i = 0; i < ${this.workPerThread}; i++) {
        dotProd[i] = vec4<f32>(0.0);
      }
      for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + 1) {
        let dyR = f32(dyCorner.x + wR) / f32(uniforms.strides.x);
        let wRPerm = uniforms.filterDims.x - 1 - wR;
        if (dyR < 0.0 || dyR >= f32(uniforms.outBackprop[1]) ||
            fract(dyR) > 0.0) {
          continue;
        }
        let idyR = i32(dyR);

        for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + 1) {
          let dyC = f32(dyCorner.y + wC) / f32(uniforms.strides.y);
          let dyC2 = f32(dyCorner.y + 1 + wC) / f32(uniforms.strides.y);
          let wCPerm = uniforms.filterDims.y - 1 - wC;
          var bDyCVal = true;
          var bDyCVal2 = true;
          if (dyC < 0.0 || dyC >= f32(uniforms.outBackprop[2]) ||
              fract(dyC) > 0.0) {
            bDyCVal = false;
          }
          if (dyC2 < 0.0 || dyC2 >= f32(uniforms.outBackprop[2]) ||
              fract(dyC2) > 0.0) {
            bDyCVal2 = false;
          }

          let idyC = i32(dyC);
          let idyC2 = i32(dyC2);
          if (bDyCVal && bDyCVal2) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[0] = dotProd[0] + tmpval;
              xValue = getDy(batch, idyR, idyC2, d2);
              dotProd[1] = dotProd[1] + vec4<f32>(dot(xValue, wValue0),
                                                  dot(xValue, wValue1),
                                                  dot(xValue, wValue2),
                                                  dot(xValue, wValue3));
            }
          } else if (bDyCVal) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[0] = dotProd[0] + tmpval;
            }
          } else if (bDyCVal2) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC2, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[1] = dotProd[1] + tmpval;
            }
          }
        }
      }

      for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
        let coords = vec4<i32>(batch, r, c + i, d1);
        if (coordsInBounds4D(coords, uniforms.outShape)) {
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], dotProd[i]);
        }
      }
    }
    `;return this.isVec4?`
    ${r}
    `:`
    ${$("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d1 = coords[${i}];

        let dyCorner = vec2<i32>(coords[${e}], coords[${t}]) - uniforms.pads;
        let dyRCorner = dyCorner.x;
        let dyCCorner = dyCorner.y;

        // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + 1) {
          let dyR = (f32(dyRCorner) + f32(wR)) / f32(uniforms.strides.x);
          let wRPerm = uniforms.filterDims.x - 1 - wR;
          if (dyR < 0.0 || dyR >= f32(uniforms.outBackprop[1]) || fract(dyR) > 0.0 ||
              wRPerm < 0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + 1) {
            let dyC = (f32(dyCCorner) + f32(wC)) / f32(uniforms.strides.y);
            let wCPerm = uniforms.filterDims.y - 1 - wC;
            if (dyC < 0.0 || dyC >= f32(uniforms.outBackprop[2]) ||
                fract(dyC) > 0.0 || wCPerm < 0) {
              continue;
            }
            let idyC = i32(dyC);

            for (var d2 = 0; d2 < uniforms.outBackprop[3]; d2 = d2 + 1) {
              let xValue = ${this.isChannelsLast?"getDy(batch, idyR, idyC, d2)":"getDy(batch, d2, idyR, idyC)"};
              let wValue = getW(wRPerm, wCPerm, d1, d2);
              dotProd = dotProd + xValue * wValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class iJ{constructor(e){this.variableNames=["x","dy"],this.uniforms="pads : vec2<i32>, strides : vec2<i32>, batchSize : i32, outHeight : i32, outWidth : i32, inHeight : i32, inWidth : i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast="channelsLast"===e.dataFormat,this.shaderKey=`conv2DDerFilter_${this.isChannelsLast}`}getUserCode(){return`
    ${$("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wR = coords[0];
        let wC = coords[1];
        let d1 = coords[2];
        let d2 = coords[3];

        // Convolve x(?, ?, d1) with dy(:, :, d2) to get dw(wR, wC, d1, d2).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b = b + 1) {
          for (var yR = 0; yR < uniforms.outHeight; yR = yR + 1) {
            let xR = wR + yR * uniforms.strides[0] - uniforms.pads[0];
            if (xR < 0 || xR >= uniforms.inHeight) {
              continue;
            }

            for (var yC = 0; yC < uniforms.outWidth; yC = yC + 1) {
              let xC = wC + yC * uniforms.strides[1] - uniforms.pads[1];

              if (xC < 0 || xC >= uniforms.inWidth) {
                continue;
              }

              if (${this.isChannelsLast}) {
                let dyValue = getDy(b, yR, yC, d2);
                let xValue = getX(b, xR, xC, d1);
                dotProd = dotProd + xValue * dyValue;
              } else {
                let dyValue = getDy(b, d2, yR, yC);
                let xValue = getX(b, d1, xR, xC);
                dotProd = dotProd + xValue * dyValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class i2{constructor(e){this.variableNames=["x","dy"],this.uniforms=`pads : vec3<i32>, strides : vec3<i32>, batchSize : i32, outDepth : i32,
       outHeight : i32, outWidth : i32, inDepth : i32, inHeight : i32, inWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3DDerFilter"}getUserCode(){return`
    ${$("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wF = coords.x;
        let wR = coords.y;
        let wC = coords.z;
        let d1 = coords.w;
        let d2 = coords.u;

        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b++) {
          for (var yF = 0; yF < uniforms.outDepth; yF++) {
            let xF = wF + yF * uniforms.strides[0] - uniforms.pads[0];
            if (xF < 0 || xF >= uniforms.inDepth) {
              continue;
            }

            for (var yR = 0; yR < uniforms.outHeight; yR++) {
              let xR = wR + yR * uniforms.strides[1] - uniforms.pads[1];
              if (xR < 0 || xR >= uniforms.inHeight) {
                continue;
              }

              for (var yC = 0; yC < uniforms.outWidth; yC++) {
                let xC = wC + yC * uniforms.strides[2] - uniforms.pads[2];
                if (xC < 0 || xC >= uniforms.inWidth) {
                  continue;
                }

                let dyValue = getDy(b, yF, yR, yC, d2);
                let xValue = getX(b, xF, xR, xC, d1);
                dotProd += xValue * dyValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class i3{constructor(e){this.variableNames=["dy","W"],this.uniforms=`filterDims : vec3<i32>, pads : vec3<i32>, strides : vec3<i32>,
      outDepth : i32, outHeight : i32, outWidth : i32, outChannels : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3DDerInput"}getUserCode(){return`
    ${$("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let d1 = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyFCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        var dotProd = 0.0;
        for (var wF = 0; wF < uniforms.filterDims[0]; wF++) {
          let dyF = f32(dyFCorner + wF) / f32(uniforms.strides[0]);
          if (dyF < 0.0 || dyF >= f32(uniforms.outDepth) || fract(dyF) > 0.0) {
            continue;
          }
          let idyF = i32(dyF);

          let wFPerm = uniforms.filterDims[0] - 1 - wF;

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            let wRPerm = uniforms.filterDims[1] - 1 - wR;

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let wCPerm = uniforms.filterDims[2] - 1 - wC;

              for (var d2 = 0; d2 < uniforms.outChannels; d2++) {
                let xValue = getDy(batch, idyF, idyR, idyC, d2);
                let wValue = getW(wFPerm, wRPerm, wCPerm, d1, d2);
                dotProd += xValue * wValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}let i0={kernelName:m.Conv2DBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,pad:n,dataFormat:u,dimRoundingMode:l,filterShape:d}=r,h=m.backend_util.convertConv2DDataFormat(u),p=m.backend_util.computeConv2DInfo(a.shape,d,o,1,n,l,!1,h),c=new iJ(p),f=[{type:"int32",data:[p.padInfo.top,p.padInfo.left]},{type:"int32",data:[p.strideHeight,p.strideWidth]},{type:"int32",data:[p.batchSize]},{type:"int32",data:[p.outHeight]},{type:"int32",data:[p.outWidth]},{type:"int32",data:[p.inHeight]},{type:"int32",data:[p.inWidth]}];return i.runWebGPUProgram(c,[a,s],a.dtype,f)}};class i1{constructor(e){this.variableNames=["x","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, outBackprop : vec4<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=e.inShape,m.util.assert("channelsLast"===e.dataFormat,()=>"TODO: NCHW is unimplemented"),this.isVec4=e.inChannels%4==0&&e.outChannels%4==0,this.dispatchLayout={x:[3],y:[1,2],z:[0]},this.workgroupSize=W(this.dispatchLayout,this.outputShape,this.isVec4),this.elementsPerThread=O(this.dispatchLayout,this.outputShape,this.isVec4),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread),this.isVec4&&(this.outputComponent=4,this.variableComponents=[4,1]),this.shaderKey=`conv2DDerInputMM_${this.isVec4}_${this.elementsPerThread}`}getUserCode(){let e=this.isVec4?e_(this.elementsPerThread,this.workgroupSize):eE(this.elementsPerThread,this.workgroupSize);return`
    ${function(e=4){let t=`
      let outRow = row / uniforms.outShape[2];
      let outCol = row % uniforms.outShape[2];

      let WRow = col / (uniforms.filterDims[1] * uniforms.outBackprop[3]);
      let WCol = col / uniforms.outBackprop[3] % uniforms.filterDims[1];
      let xR = f32(outRow - uniforms.pads[0] + WRow) / f32(uniforms.strides[0]);
      let xC = f32(outCol - uniforms.pads[1] + WCol) / f32(uniforms.strides[1]);
      if (xR < 0.0 || xR >= f32(uniforms.outBackprop[1]) || fract(xR) > 0.0) {
        return ${I(e)}(0.0);
      }
      if (xC < 0.0 || xC >= f32(uniforms.outBackprop[2]) || fract(xC) > 0.0) {
        return ${I(e)}(0.0);
      }
      let coord = vec4<i32>(
          batch,
          i32(xR),
          i32(xC),
          col % uniforms.outBackprop[3]);
      return x[getIndexFromCoords4D(coord, uniforms.xShape)/${e}];`,i=`if (row < uniforms.dimAOuter && col < uniforms.dimInner) {
        ${t}
      }
      return ${I(e)}(0.0);`;return`
  fn mm_readA(batch: i32, row : i32, col : i32) -> ${I(e)} {
    ${i}
  }

  fn mm_readB(batch: i32, row : i32, col : i32) -> ${I(e)} {
    let coordX = uniforms.filterDims.x - 1 -
        row / (uniforms.filterDims[1] * uniforms.outBackprop[3]);
    let coordY = uniforms.filterDims.y - 1 -
        (row / uniforms.outBackprop[3]) % uniforms.filterDims[1];
    if (row < uniforms.dimInner && col < uniforms.dimBOuter &&
        coordX >= 0 && coordY >= 0) {
      let rowInner = row % uniforms.outBackprop[3];
      let coord = vec4<i32>(coordX, coordY, col, rowInner);
      ${(e=>{switch(e){case 1:return"return W[getIndexFromCoords4D(coord, uniforms.wShape)];";case 4:return`
            let coord1 = vec4<i32>(coordX, coordY, col + 1, rowInner);
            let coord2 = vec4<i32>(coordX, coordY, col + 2, rowInner);
            let coord3 = vec4<i32>(coordX, coordY, col + 3, rowInner);
            let v0 = W[getIndexFromCoords4D(coord, uniforms.wShape)];
            let v1 = W[getIndexFromCoords4D(coord1, uniforms.wShape)];
            let v2 = W[getIndexFromCoords4D(coord2, uniforms.wShape)];
            let v3 = W[getIndexFromCoords4D(coord3, uniforms.wShape)];
            return vec4<f32>(v0, v1, v2, v3);
            `;default:throw Error(`innerElementSize ${e} is not supported.`)}})(e)}
    }
    return ${I(e)}(0.0);
  }

  fn mm_write(batch: i32, row : i32, col : i32, valueInput : ${I(e)}) {
    if (row < uniforms.dimAOuter && col < uniforms.dimBOuter) {
      var value = valueInput;
      let outCoord = vec4<i32>(
          batch,
          row / uniforms.outShape[2],
          row % uniforms.outShape[2],
          col);
      result[getIndexFromCoords4D(outCoord, uniforms.outShape)/${e}] = value;
    }
  }`}(this.isVec4?4:1)}
    ${e}
    `}}let i4={kernelName:m.Conv2DBackpropInput,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{dy:s,filter:o}=i,{inputShape:n,strides:u,pad:l,dataFormat:d,dimRoundingMode:h}=a,p=m.backend_util.convertConv2DDataFormat(d),c=m.backend_util.computeConv2DInfo(n,o.shape,u,1,l,h,!1,p),f=[{type:"int32",data:[c.filterHeight,c.filterWidth]},{type:"int32",data:[c.filterHeight-1-c.padInfo.top,c.filterWidth-1-c.padInfo.left]},{type:"int32",data:[c.strideHeight,c.strideWidth]},{type:"int32",data:[c.batchSize,c.outHeight,c.outWidth,c.outChannels]}];if((0,m.env)().getBool("WEBGPU_USE_NAIVE_CONV2D_TRANSPOSE")||"channelsLast"!==c.dataFormat)t=new iZ(c);else{t=new i1(c);let e=c.inHeight*c.inWidth,i=c.inChannels,r=c.filterHeight*c.filterWidth*c.outChannels;f.push({type:"uint32",data:[e]},{type:"uint32",data:[i]},{type:"uint32",data:[r]})}return r.runWebGPUProgram(t,[s,o],"float32",f)}};class i6{constructor(e){this.variableNames=["x","W"],this.uniforms="filterDims: vec3<i32>, pads: vec3<i32>, strides: vec3<i32>, dilations: vec3<i32>,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3dnaive"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let batch = coords.x;
        let d2 = coords.u;

        let xFRCCorner = vec3<i32>(coords.y, coords.z, coords.w) * uniforms.strides - uniforms.pads;
        let xFCorner = xFRCCorner.x;
        let xRCorner = xFRCCorner.y;
        let xCCorner = xFRCCorner.z;

        let inputDepthNearestVec4 = (uniforms.xShape.u / 4) * 4;
        let inputDepthVec4Remainder = uniforms.xShape.u % 4;

        var dotProd = 0.0;
        for (var wF = 0; wF < uniforms.filterDims[0]; wF++) {
          let xF = xFCorner + wF * uniforms.dilations[0];
          if (xF < 0 || xF >= uniforms.xShape.y) {
            continue;
          }

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let xR = xRCorner + wR * uniforms.dilations[1];
            if (xR < 0 || xR >= uniforms.xShape.z) {
              continue;
            }

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let xC = xCCorner + wC * uniforms.dilations[2];
              if (xC < 0 || xC >= uniforms.xShape.w) {
                continue;
              }

              for (var d1 = 0; d1 < inputDepthNearestVec4; d1 += 4) {
                let xValues = vec4<f32>(
                  getX(batch, xF, xR, xC, d1),
                  getX(batch, xF, xR, xC, d1 + 1),
                  getX(batch, xF, xR, xC, d1 + 2),
                  getX(batch, xF, xR, xC, d1 + 3)
                );
                let wValues = vec4<f32>(
                  getW(wF, wR, wC, d1, d2),
                  getW(wF, wR, wC, d1 + 1, d2),
                  getW(wF, wR, wC, d1 + 2, d2),
                  getW(wF, wR, wC, d1 + 3, d2)
                );

                dotProd += dot(xValues, wValues);
              }

              if (inputDepthVec4Remainder == 1) {
                dotProd += getX(batch, xF, xR, xC, inputDepthNearestVec4) *
                  getW(wF, wR, wC, inputDepthNearestVec4, d2);
              } else if (inputDepthVec4Remainder == 2) {
                let xValues = vec2<f32>(
                  getX(batch, xF, xR, xC, inputDepthNearestVec4),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1)
                );
                let wValues = vec2<f32>(
                  getW(wF, wR, wC, inputDepthNearestVec4, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 1, d2)
                );
                dotProd += dot(xValues, wValues);
              } else if (inputDepthVec4Remainder == 3) {
                let xValues = vec3<f32>(
                  getX(batch, xF, xR, xC, inputDepthNearestVec4),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2)
                );
                let wValues = vec3<f32>(
                  getW(wF, wR, wC, inputDepthNearestVec4, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 1, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 2, d2)
                );
                dotProd += dot(xValues, wValues);
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }`}}let i5={kernelName:m.Conv3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dilations:u}=r,l=m.backend_util.computeConv3DInfo(a.shape,s.shape,o,u,n),d=[l.padInfo.front,l.padInfo.top,l.padInfo.left],h=[{type:"int32",data:[l.filterDepth,l.filterHeight,l.filterWidth]},{type:"int32",data:[...d]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.dilationDepth,l.dilationHeight,l.dilationWidth]}],p=new i6(l),c=(0,m.upcastType)(a.dtype,s.dtype);return i.runWebGPUProgram(p,[a,s],c,h)}},i8={kernelName:m.Conv3DBackpropFilterV2,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,pad:n,filterShape:u}=r,l=m.backend_util.computeConv3DInfo(a.shape,u,o,1,n),d=new i2(l),h=[{type:"int32",data:[l.padInfo.front,l.padInfo.top,l.padInfo.left]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.batchSize]},{type:"int32",data:[l.outDepth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"int32",data:[l.inDepth]},{type:"int32",data:[l.inHeight]},{type:"int32",data:[l.inWidth]}];return i.runWebGPUProgram(d,[a,s],s.dtype,h)}},i7={kernelName:m.Conv3DBackpropInputV2,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,filter:s}=t,{strides:o,pad:n,inputShape:u}=r,l=m.backend_util.computeConv3DInfo(u,s.shape,o,1,n),d=new i3(l),h=[{type:"int32",data:[l.filterDepth,l.filterHeight,l.filterWidth]},{type:"int32",data:[l.filterDepth-1-l.padInfo.front,l.filterHeight-1-l.padInfo.top,l.filterWidth-1-l.padInfo.left]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.outDepth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"int32",data:[l.outChannels]}];return i.runWebGPUProgram(d,[a,s],a.dtype,h)}},i9=e4({opType:p.COS}),re={kernelName:m.Cos,backendName:"webgpu",kernelFunc:i9},rt=e4({opType:p.COSH}),ri={kernelName:m.Cosh,backendName:"webgpu",kernelFunc:rt};class rr{constructor(e,t,i,r){this.variableNames=["Image","Boxes","BoxInd"],this.uniforms="extrapolationValue : f32,",this.workgroupSize=[64,1,1],this.size=!0;let[a]=t;this.outputShape=[a,i[0],i[1],e],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.methodId="bilinear"===r?1:0,this.cropHeightBiggerThan1=this.outputShape[1]>1,this.cropWidthBiggerThan1=this.outputShape[2]>1,this.shaderKey=`cropAndResize_${this.methodId}_${this.cropHeightBiggerThan1}_${this.cropWidthBiggerThan1}`}getUserCode(){let[e,t]=["f32(uniforms.imageShape[1] - 1)","f32(uniforms.imageShape[2] - 1)"],[i,r,a]=this.cropHeightBiggerThan1?[`(${e} / f32(uniforms.outShape[1] - 1))`,"(y2-y1) * height_ratio",`y1*${e} + f32(y)*(height_scale)`]:["0.0","0.0",`0.5 * (y1+y2) * ${e}`],[s,o,n]=this.cropWidthBiggerThan1?[`(${t} / f32(uniforms.outShape[2] - 1))`,"(x2-x1) * width_ratio",`x1*${t} + f32(x)*(width_scale)`]:["0.0","0.0",`0.5 * (x1+x2) * ${t}`];return`
    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let height_ratio = f32(${i});
        let width_ratio = f32(${s});
        let b = coords[0];
        let y = coords[1];
        let x = coords[2];
        let d = coords[3];
        // get box vals
        let y1 = getBoxes(b, 0);
        let x1 = getBoxes(b, 1);
        let y2 = getBoxes(b, 2);
        let x2 = getBoxes(b, 3);
        // get image in batch index
        let bInd = i32(round(getBoxInd(b)));
        if(bInd < 0 || bInd >= uniforms.outShape[0]) {
          return;
        }
        let height_scale = ${r};
        let width_scale = ${o};
        let in_y = ${a};
        if( in_y < 0.0 || in_y > ${e} ) {
          setOutputAtIndex(index, uniforms.extrapolationValue);
          return;
        }
        let in_x = ${n};
        if( in_x < 0.0 || in_x > ${t} ) {
          setOutputAtIndex(index, uniforms.extrapolationValue);
          return;
        }
        let sourceFracIndexCR = vec2<f32>(in_x,in_y);
        if(${this.methodId} == 1) {
          // Compute the four integer indices.
          let sourceFloorCR = vec2<i32>(sourceFracIndexCR);
          let sourceCeilCR = vec2<i32>(ceil(sourceFracIndexCR));
          let topLeft = getImage(bInd, sourceFloorCR.y, sourceFloorCR.x, d);
          let bottomLeft = getImage(bInd, sourceCeilCR.y, sourceFloorCR.x, d);
          let topRight = getImage(bInd, sourceFloorCR.y, sourceCeilCR.x, d);
          let bottomRight = getImage(bInd, sourceCeilCR.y, sourceCeilCR.x, d);
          let fracCR = sourceFracIndexCR - vec2<f32>(sourceFloorCR);
          let top = topLeft + (topRight - topLeft) * fracCR.x;
          let bottom = bottomLeft + (bottomRight - bottomLeft) * fracCR.x;
          let newValue = top + (bottom - top) * fracCR.y;
          setOutputAtIndex(index, newValue);
        } else {
          // Compute the coordinators of nearest neighbor point.
          let sourceNearestCR = vec2<i32>(floor(
            sourceFracIndexCR + vec2<f32>(0.5,0.5)));
          let newValue = getImage(
            bInd, sourceNearestCR.y, sourceNearestCR.x, d);
          setOutputAtIndex(index, newValue);
        }
      }
    }
    `}}let ra={kernelName:m.CropAndResize,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{image:a,boxes:s,boxInd:o}=t,{cropSize:n,method:u,extrapolationValue:l}=r,d=new rr(a.shape[3],s.shape,n,u);return i.runWebGPUProgram(d,[a,s,o],"float32",[{type:"float32",data:[l]}])}};(u=c||(c={})).Prod="*",u.Sum="+";class rs{constructor(e,t,i,r){this.variableNames=["x"],this.uniforms="index : f32,",this.size=!0,this.workgroupSize=[128,1,1],this.outputShape=t,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.exclusive=i,this.reverse=r,this.op=e,this.shaderKey=`cum_${this.op}_${this.exclusive}_${this.reverse}`}getUserCode(){let e=this.outputShape.length,t=this.op===c.Prod?"1.0":"0.0",i=this.exclusive?t:`getX(${ro(e,"coords",this.op)})`,r=this.outputShape[this.outputShape.length-1],a="",s="";return this.exclusive?(a=this.reverse?`end != ${r-1}`:"end != 0",s=this.reverse?"end + 1":"end - 1"):(a=this.reverse?`end + pow2 < ${r}`:"end >= pow2",s=this.reverse?"end + pow2":"end - pow2"),`
      ${$("index")} {
       if (index < uniforms.size) {
         var coords = getCoordsFromIndex(index);

         let end = ${rn(e,"coords",this.op)};
         var val = ${i};
         let pow2 = i32(pow(2.0, uniforms.index));
         if (${a}) {
           let idx = ${s};
           ${rn(e,"coords",this.op)} = idx;
           val ${this.op}= getX(${ro(e,"coords",this.op)});
         }
         setOutputAtIndex(index, val);
       }
      }
    `}}function ro(e,t,i){if(1===e)return`${t}`;if(2===e)return`${t}.x, ${t}.y`;if(3===e)return`${t}.x, ${t}.y, ${t}.z`;if(4===e)return`${t}.x, ${t}.y, ${t}.z, ${t}.w`;throw Error(`Cumulative ${i} for rank ${e} is not yet supported`)}function rn(e,t,i){if(1===e)return`${t}`;if(2===e)return`${t}.y`;if(3===e)return`${t}.z`;if(4===e)return`${t}.w`;throw Error(`Cumulative ${i} for rank ${e} is not yet supported`)}function ru(e,t,i,r,a,s){let o=t.shape.length,n=m.backend_util.getAxesPermutation([r],o),u=t;null!=n&&(u=tG({inputs:{x:t},backend:i,attrs:{perm:n}}));let l=m.backend_util.getInnerMostAxes(1,o)[0];if(l!==o-1)throw Error(`WebGPU cumprod shader expects an inner-most axis=${t.shape.length-1} but got axis=${r}`);let d=u.shape[l],h=eJ({inputs:{x:u},backend:i});for(let t=0;t<=Math.ceil(Math.log2(d))-1;t++){let r=new rs(e,u.shape,!1,s),a=h,o=[{type:"float32",data:[t]}];h=i.runWebGPUProgram(r,[h],h.dtype,o),i.disposeData(a.dataId)}if(a){let t=new rs(e,u.shape,a,s),r=h;h=i.runWebGPUProgram(t,[h],h.dtype,[{type:"float32",data:[0]}]),i.disposeData(r.dataId)}if(null!=n){let e=tG({inputs:{x:h},backend:i,attrs:{perm:m.backend_util.getUndoAxesPermutation(n)}});return i.disposeData(h.dataId),i.disposeData(u.dataId),e}return h}let rl={kernelName:m.Cumprod,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,exclusive:o,reverse:n}=r;return ru(c.Prod,a,i,s,o,n)}},rd={kernelName:m.Cumsum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,exclusive:o,reverse:n}=r;return ru(c.Sum,a,i,s,o,n)}},rh={kernelName:m.DenseBincount,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,weights:s}=t,{size:o,binaryOutput:n}=r,u=1===a.shape.length,l=m.util.sizeFromShape(s.shape)>0,d=s.dtype,h=u?[a.shape[0]]:[a.shape[0],a.shape[1]],p=eH({backend:i,attrs:{shape:u?[o]:[a.shape[0],o],value:0,dtype:d}}),c=new iI(h,l,n),f=[{type:"int32",data:[o]}],g=l?[a,s]:[a];return i.runWebGPUProgram(c,g,d,f,p)}};class rp{constructor(e,t){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.uniforms="blockSize : i32,",this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`depthToSpace_${t}`,this.dataFormat=t}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let h = ${this.getHeightCoordString()};
          let w = ${this.getWidthCoordString()};
          let d = ${this.getDepthCoordString()};

          let in_h = h / uniforms.blockSize;
          let offset_h = h % uniforms.blockSize;
          let in_w = w / uniforms.blockSize;
          let offset_w = w % uniforms.blockSize;
          let offset_d = (offset_h * uniforms.blockSize + offset_w) *
            ${this.getOutputDepthSize()};
          let in_d = d + offset_d;

          let rlt = ${this.getInputSamplingString()};
          setOutputAtIndex(index, rlt);
        }
      }`}getHeightCoordString(){return"NHWC"===this.dataFormat?"coords[1]":"coords[2]"}getWidthCoordString(){return"NHWC"===this.dataFormat?"coords[2]":"coords[3]"}getDepthCoordString(){return"NHWC"===this.dataFormat?"coords[3]":"coords[1]"}getOutputDepthSize(){return"NHWC"===this.dataFormat?"uniforms.outShape[3]":"uniforms.outShape[1]"}getInputSamplingString(){return"NHWC"===this.dataFormat?"getX(b, in_h, in_w, in_d)":"getX(b, in_d, in_h, in_w)"}}let rc={kernelName:m.DepthToSpace,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockSize:s,dataFormat:o}=r,n=a.shape[0],u="NHWC"===o?a.shape[1]:a.shape[2],l="NHWC"===o?a.shape[2]:a.shape[3],d="NHWC"===o?a.shape[3]:a.shape[1],h=u*s,p=l*s,c=d/(s*s),f=new rp("NHWC"===o?[n,h,p,c]:[n,c,h,p],o);return i.runWebGPUProgram(f,[a],a.dtype,[{type:"int32",data:[s]}])}};class rf{constructor(e,t,i,r=!1,a=null,s=!1){this.variableNames=["x","W"],this.uniforms="pads : vec2<i32>, inDims : vec2<i32>,",this.workgroupSize=[16,16,1],this.outputShape=e,this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),r&&this.variableNames.push("bias"),s&&this.variableNames.push("preluActivationWeights"),this.addBias=r,this.activation=a,this.hasPreluActivation=s,this.filterHeight=t,this.filterWidth=i,this.shaderKey=`depthwiseNCHW_${this.activation}_${this.filterHeight}_${this.filterWidth}`}getUserCode(){let e=this.filterWidth*this.filterHeight,t=this.workgroupSize[0]*this.workgroupSize[1]*this.workgroupSize[2],i=this.workgroupSize[1]+this.filterHeight-1,r=this.workgroupSize[0]+this.filterWidth-1;return`
      ${eP(this.activation,this.hasPreluActivation,!1,4)}

      var<workgroup> mm_Asub : array<array<f32, ${r}>, ${i}>;
      var<workgroup> mm_Bsub : array<array<f32, ${this.filterWidth}>, ${this.filterHeight}>;
      fn readX(batch : i32, channel : i32, row : i32, col : i32) -> f32 {
        var value = 0.0;
        if (row >=0 && row < uniforms.inDims[0] && col >=0 && col < uniforms.inDims[1])
        {
          value = getX(batch, channel, row, col);
        }
        return value;
      }

      ${$()} {
        let coords = getOutputCoords();
        let batch = coords[0];
        let xRCCorner = vec2<i32>(coords.zw) - uniforms.pads;
        let channelMul = uniforms.wShape[3];
        let d1 = coords[1] / channelMul;
        let q = coords[1] % channelMul;

        let inputRowStart = xRCCorner.x;
        let inputColStart = xRCCorner.y;

        let localRow = i32(localId.y);
        let localCol = i32(localId.x);

        // Load one tile of X into local memory.
        for (var inputRow = localRow; inputRow < ${i}; inputRow = inputRow + ${this.workgroupSize[1]}) {
          for (var inputCol = localCol; inputCol < ${r}; inputCol = inputCol + ${this.workgroupSize[0]}) {
            let rowOffset = inputRow - localRow;
            let colOffset = inputCol - localCol;
            mm_Asub[inputRow][inputCol] = readX(batch, d1, inputRowStart + rowOffset, inputColStart + colOffset);
          }
        }

        // Load one tile of W into local memory.
        var wIndex = i32(localIndex);
        ${e<t?`if (wIndex < ${e})`:`for(; wIndex < ${e}; wIndex = wIndex + ${t})`}

        {
          let wRow = wIndex / ${this.filterWidth};
          let wCol = wIndex % ${this.filterWidth};
          mm_Bsub[wRow][wCol] = getW(wRow, wCol, d1, q);
        }

        workgroupBarrier();

        var value = 0.0;
        for (var wR = 0; wR < ${this.filterHeight}; wR = wR + 1) {
          for (var wC = 0; wC < ${this.filterWidth}; wC = wC + 1) {
            let xVal = mm_Asub[localRow + wR][localCol + wC];
            let wVal = mm_Bsub[wR][wC];
            value = fma(xVal, wVal, value);
          }
        }
        ${ez(this.addBias,this.activation)}
        if (coordsInBounds4D(coords, uniforms.outShape)) {
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }
    `}}class rm{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms="pads : vec2<i32>, inDims : vec2<i32>, virtualWidth : i32,",this.workgroupSize=[64,1,1],this.workPerThread=4,this.outputComponent=4,this.outputShape=e.outShape,this.virtualWidth=Math.ceil(this.outputShape[2]/this.workPerThread)*this.workPerThread;let a=[this.outputShape[0],this.outputShape[1],this.virtualWidth,this.outputShape[3]];this.dispatchLayout=U(a),this.dispatch=E(this.dispatchLayout,a,this.workgroupSize,[this.outputComponent*this.workPerThread,1,1]),m.util.assert("channelsLast"===e.dataFormat,()=>"TODO: NCHW is unimplemented"),t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.convInfo=e,this.addBias=t,this.activation=i,this.hasPreluActivation=r,this.shaderKey=`depthwiseVec4_${i}_${this.convInfo.filterHeight}_${this.convInfo.filterWidth}_${this.convInfo.strideHeight}_${this.convInfo.strideWidth}_${this.workPerThread}`}getUserCode(){let e=(this.workPerThread-1)*this.convInfo.strideWidth+this.convInfo.filterWidth,t=this.convInfo.strideHeight,i=this.convInfo.strideWidth;return`
      ${eP(this.activation,this.hasPreluActivation,!0,4)}
      fn readX(batch : i32, row : i32, col : i32, channel : i32) -> vec4<f32> {
        var value = vec4<f32>(0.0);
        if (col >=0 && col < uniforms.inDims[1]) {
          value = getX(batch, row, col, channel);
        }
        return value;
      }

      ${$("index")} {
        let width0 = uniforms.outShape[3] / ${this.outputComponent};
        let d1 = (index % width0) * ${this.outputComponent};
        var index1 = index / width0;
        let width1 = uniforms.virtualWidth / ${this.workPerThread};
        let c = (index1 % width1) * ${this.workPerThread};
        index1 = index1 / width1;
        let r = index1 % uniforms.outShape[1];
        let batch = index1 / uniforms.outShape[1];

        let xRCCorner = vec2<i32>(r, c) * vec2<i32>(${t}, ${i}) - uniforms.pads;

        let xRCorner = xRCCorner.x;
        let xCCorner = xRCCorner.y;
        var xVals : array<vec4<f32>, ${e}>;
        var dotProd : array<vec4<f32>, ${this.workPerThread}>;
        for (var i = 0; i < ${this.workPerThread}; i++) {
          dotProd[i] = vec4<f32>(0.0);
        }

        // Use constant instead of uniform can give better performance.
        for (var wR = 0; wR < ${this.convInfo.filterHeight}; wR = wR + 1) {
          let xR = xRCorner + wR;
          if (xR >=0 && xR < uniforms.inDims[0]) {
            for (var i = 0; i < ${e}; i++) {
              xVals[i] = readX(batch, xR, xCCorner + i, d1);
            }
            for (var wC = 0; wC < ${this.convInfo.filterWidth}; wC = wC + 1) {
              let wValue = getW(wR, wC, d1, 0);
              for (var i = 0; i < ${this.workPerThread}; i++) {
                dotProd[i] = fma(xVals[i * ${i} + wC], wValue, dotProd[i]);
              }
            }
          }
        }

        for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let coords = vec4<i32>(batch, r, c + i, d1);
          if (coordsInBounds4D(coords, uniforms.outShape)) {
            var value = dotProd[i];
            ${ez(this.addBias,this.activation)}
            setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
          }
        }
      }
    `}}class rg{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms=`pads : vec2<i32>, inDims : vec2<i32>, filterHeight : i32,
      filterWidth : i32, strides : vec2<i32>, dilations : vec2<i32>,`,this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast="channelsLast"===e.dataFormat,t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.convInfo=e,this.addBias=t,this.activation=i,this.hasPreluActivation=r,this.shaderKey=`depthwise_${this.activation}_${this.isChannelsLast}`}getUserCode(){let e=this.isChannelsLast?"getX(batch, xR, xC, d1);":"getX(batch, d1, xR, xC);";return`
      ${eP(this.activation,this.hasPreluActivation,!1,4)}

      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let batch = coords[0];
          let xRCCorner = vec2<i32>(coords.${this.isChannelsLast?"yz":"zw"}) * uniforms.strides - uniforms.pads;
          let d2 = coords[${this.isChannelsLast?3:1}];
          let channelMul = uniforms.wShape[3];
          let d1 = d2 / channelMul;
          let q = d2 % channelMul;

          let inputRowStart = xRCCorner.x;
          let inputColStart = xRCCorner.y;
          let inputRowEnd = inputRowStart + uniforms.filterHeight *
              uniforms.dilations[0];
          let inputColEnd = inputColStart + uniforms.filterWidth *
              uniforms.dilations[1];

          // Convolve x(?, ?, d1)|x(d1, ?, ?) with w(:, :, d1, q) to get
          // y(yR, yC, d2)|y(d2, yR, yC). ? = to be determined. : = across all
          // values in that axis. x(?, ?, d1) and y(yR, yC, d2) is for NHWC.
          // x(d1, ?, ?) and y(d2, yR, yC) is for NCHW.
          var value = 0.0;

          // Extract if checking out of for loop for performance.
          if (inputRowStart >= 0 && inputColStart >= 0 &&
            inputRowEnd < uniforms.inDims[0] &&
                inputColEnd < uniforms.inDims[1]) {
              for (var wR = 0; wR < uniforms.filterHeight; wR = wR + 1) {
                let xR = inputRowStart + wR * uniforms.dilations[0];

                for (var wC = 0; wC < uniforms.filterWidth; wC = wC + 1) {
                  let xC = inputColStart + wC * uniforms.dilations[1];

                  let xVal = ${e};
                  let wVal = getW(wR, wC, d1, q);
                  value = value + xVal * wVal;
                }
              }
            } else {
              for (var wR = 0; wR < uniforms.filterHeight; wR = wR + 1) {
                let xR = inputRowStart + wR * uniforms.dilations[0];

                if (xR < 0 || xR >= uniforms.inDims[0]) {
                  continue;
                }

                for (var wC = 0; wC < uniforms.filterWidth; wC = wC + 1) {
                  let xC = inputColStart + wC * uniforms.dilations[1];

                  if (xC < 0 || xC >= uniforms.inDims[1]) {
                    continue;
                  }

                  let xVal = ${e};
                  let wVal = getW(wR, wC, d1, q);
                  value = value + xVal * wVal;
                }
              }
            }
            ${ez(this.addBias,this.activation)}
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }
    `}}let rx={kernelName:m.DepthwiseConv2dNative,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s,filter:o}=i,{strides:n,pad:u,dataFormat:l,dilations:d,dimRoundingMode:h}=a,p=m.backend_util.convertConv2DDataFormat(l),c=d;null==c&&(c=[1,1]);let f=m.backend_util.computeConv2DInfo(s.shape,o.shape,n,c,u,h,!0,p),g=[{type:"int32",data:[f.padInfo.top,f.padInfo.left]},{type:"int32",data:[f.inHeight,f.inWidth]}],x="channelsLast"===f.dataFormat;return!x&&f.inHeight>16&&f.inWidth>16&&1===f.strideHeight&&1===f.strideWidth&&1===f.dilationWidth&&1===f.dilationHeight&&f.inChannels===f.outChannels?t=new rf(f.outShape,f.filterHeight,f.filterWidth):x&&f.outHeight>4&&f.outWidth>4&&f.strideWidth<=2&&f.inChannels===f.outChannels&&1===f.dilationHeight&&1===f.dilationWidth&&f.inChannels%4==0?(t=new rm(f),g.push({type:"int32",data:[t.virtualWidth]})):(t=new rg(f),g.push({type:"int32",data:[f.filterHeight]},{type:"int32",data:[f.filterWidth]},{type:"int32",data:[f.strideHeight,f.strideWidth]},{type:"int32",data:[f.dilationHeight,f.dilationWidth]})),r.runWebGPUProgram(t,[s,o],s.dtype,g)}};class ry{constructor(e){this.variableNames=["x","dy"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, filterDims : vec2<i32>, outHeight : i32,
      outWidth : i32, inHeight : i32, inWidth : i32, batchSize : i32, channelMul : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="depthwise_conv2d_backprop_filter"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wR = coords[0];
        let wC = coords[1];
        let d1 = coords[2];
        let dm = coords[3];
        let d2 = d1 * uniforms.channelMul + dm;

        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b++) {
          for (var yR = 0; yR < uniforms.outHeight; yR++) {
            let xR = wR + yR * uniforms.strides[0] - uniforms.pads[0];

            if (xR < 0 || xR >= uniforms.inHeight) {
              continue;
            }

            for (var yC = 0; yC < uniforms.outWidth; yC++) {
              let xC = wC + yC * uniforms.strides[1] - uniforms.pads[1];

              if (xC < 0 || xC >= uniforms.inWidth) {
                continue;
              }

              let dyValue = getDy(b, yR, yC, d2);
              let xValue = getX(b, xR, xC, d1);
              dotProd += xValue * dyValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class rw{constructor(e){this.variableNames=["dy","W"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32, channelMul : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="depthwise_conv2d_backprop_input"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d1 = coords[3];
        let dyCorner = coords.yz - uniforms.pads;
        let dyRCorner = dyCorner.x;
        let dyCCorner = dyCorner.y;

        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }

          let idyR = i32(dyR);
          let wRPerm = uniforms.filterDims[0] - 1 - wR;

          for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }

            let idyC = i32(dyC);
            let wCPerm = uniforms.filterDims[1] - 1 - wC;

            for (var dm = 0; dm < uniforms.channelMul; dm++) {
              let d2 = d1 * uniforms.channelMul + dm;
              let xValue = getDy(batch, idyR, idyC, d2);
              let wValue = getW(wRPerm, wCPerm, d1, dm);
              dotProd += xValue * wValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let rb={kernelName:m.DepthwiseConv2dNativeBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,dilations:n,pad:u,dimRoundingMode:l,filterShape:d}=r,h=m.backend_util.computeConv2DInfo(a.shape,d,o,n,u,l,!0),p=new ry(h),c=[{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.filterHeight,h.filterWidth]},{type:"int32",data:[h.outHeight]},{type:"int32",data:[h.outWidth]},{type:"int32",data:[h.inHeight]},{type:"int32",data:[h.inWidth]},{type:"int32",data:[h.batchSize]},{type:"int32",data:[h.outChannels/h.inChannels]}];return i.runWebGPUProgram(p,[a,s],"float32",c)}},rC={kernelName:m.DepthwiseConv2dNativeBackpropInput,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,filter:s}=t,{strides:o,dilations:n,pad:u,dimRoundingMode:l,inputShape:d}=r,h=m.backend_util.computeConv2DInfo(d,s.shape,o,n,u,l,!0),p=new rw(h),c=[{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.filterHeight-1-h.padInfo.top,h.filterWidth-1-h.padInfo.left]},{type:"int32",data:[h.filterHeight,h.filterWidth]},{type:"int32",data:[h.outHeight]},{type:"int32",data:[h.outWidth]},{type:"int32",data:[h.outChannels/h.inChannels]}];return i.runWebGPUProgram(p,[a,s],a.dtype,c)}};class rS{constructor(e){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,e],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="diag"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let value = select(0.0, getX(coords[0]), coords[0] == coords[1]);
          setOutputAtIndex(index, value);
        }
      }
    `}}let rv={kernelName:m.Diag,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t,a=[...r.shape,...r.shape],s=m.util.sizeFromShape(r.shape),o=eK({inputs:{x:r},backend:i,attrs:{shape:[s]}}),n=new rS(s),u=i.runWebGPUProgram(n,[o],o.dtype),l=eK({inputs:{x:u},backend:i,attrs:{shape:a}});return i.disposeData(o.dataId),i.disposeData(u.dataId),l}};class rI{constructor(e){this.variableNames=["x","w"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="dilation2d"}getUserCode(){return`
       ${$("index")} {
         if (index < uniforms.size) {
           let neg_infinity = -3.4e38;
           let coords = getOutputCoords();
           let batch = coords.x;
           let d1 = coords.w;
           let outTopLeftCorner = coords.yz * uniforms.strides - uniforms.pads;
           let hBeg = outTopLeftCorner.x;
           let wBeg = outTopLeftCorner.y;

           var curVal = neg_infinity;
           for (var h = 0; h < uniforms.filterDims[0]; h = h + 1) {
             let hIn = hBeg + h * uniforms.dilations[0];

             if (hIn >= 0 && hIn < uniforms.xShape[1]) {
               for (var w = 0; w < uniforms.filterDims[1]; w = w + 1) {
                 let wIn = wBeg + w * uniforms.dilations[1];

                 if (wIn >= 0 && wIn < uniforms.xShape[2]) {
                   let val = getX(batch, hIn, wIn, d1) + getW(h, w, d1);
                   if (val > curVal) {
                     curVal = val;
                   }
                 }
               }
             }
           }

           setOutputAtIndex(index, curVal);
         }
       }
     `}}let rk={kernelName:m.Dilation2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dilations:u}=r,l=m.backend_util.computeDilation2DInfo(a.shape,s.shape,o,n,"NHWC",u),d=[l.padInfo.top,l.padInfo.left],h=[{type:"int32",data:[l.filterHeight,l.filterWidth]},{type:"int32",data:[...d]},{type:"int32",data:[l.strideHeight,l.strideWidth]},{type:"int32",data:[l.dilationHeight,l.dilationWidth]}],p=new rI(l);return i.runWebGPUProgram(p,[a,s],a.dtype,h)}};class rR{constructor(e,t){if(this.variableNames=["x","w","dy"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>, dySize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e.inShape,this.dispatchLayout=U(e.outShape),this.dispatch=E(this.dispatchLayout,e.outShape,this.workgroupSize),"float32"!==t&&"int32"!==t)throw Error(`Dilation2DBackpropInput only supports float32 and int32
          types, does not support ${t} type.`);this.type=t,this.shaderKey="dilation2DBackpropInput"}getUserCode(){return`
       ${$("index")} {
         if (index < uniforms.dySize) {
           let coords = getDyCoordsFromIndex(index);
           let b = coords[0];
           let r = coords[1];
           let c = coords[2];
           let d = coords[3];

           let dyCorner = vec2<i32>(r, c) * uniforms.strides - uniforms.pads;
           var curVal = -3.4e38;  // neg_infinity
           var xRMax = 0;
           var xCMax = 0;

           // In the case of multiple argmax branches, we only back-propagate
           // along the last branch, i.e., the one with largest value of
           // 'wR * uniforms.filterDims[1] + wC', similarly to the max-pooling
           // backward routines.
           for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
             let xR = dyCorner.x + wR * uniforms.dilations[0];

             if (xR >= 0 && xR < uniforms.xShape[1]) {
               for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
                 let xC = dyCorner.y + wC * uniforms.dilations[1];

                 if (xC >= 0 && xC < uniforms.xShape[2]) {
                   let val = getX(b, xR, xC, d) + getW(wR, wC, d);
                   if (val > curVal) {
                     curVal = val;
                     xRMax = xR;
                     xCMax = xC;
                   }
                 }
               }
             }
           }

           let flatIndexIn = d + uniforms.xShape[3] *
               (xCMax + uniforms.xShape[2] * (xRMax + uniforms.xShape[1] * b));
           let value = getDy(b, r, c, d);
           ${S("&result[flatIndexIn]","value",this.type)}
         }
       }
     `}}class r${constructor(e,t,i){if(this.variableNames=["x","w","dy"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>, dySize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e.filterShape,this.dispatchLayout=U(e.outShape),this.dispatch=E(this.dispatchLayout,e.outShape,this.workgroupSize),"float32"!==i&&"int32"!==i)throw Error(`Dilation2DBackpropFilter only supports float32 and int32
          types, does not support ${i} type.`);this.type=i,this.shaderKey="dilation2DBackpropFilter"}getUserCode(){return`
       ${$("index")} {
         if (index < uniforms.dySize) {
           let coords = getDyCoordsFromIndex(index);
           let b = coords[0];
           let r = coords[1];
           let c = coords[2];
           let d = coords[3];

           let dyCorner = vec2<i32>(r, c) * uniforms.strides - uniforms.pads;
           var curVal = -3.4e38;  // neg_infinity
           var wRMax = 0;
           var wCMax = 0;

           // In the case of multiple argmax branches, we only back-propagate
           // along the last branch, i.e., the one with largest value of
           // 'wR * uniforms.filterDims[1] + wC', similarly to the max-pooling
           // backward routines.
           for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
             let xR = dyCorner.x + wR * uniforms.dilations[0];

             if (xR >= 0 && xR < uniforms.xShape[1]) {
               for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
                 let xC = dyCorner.y + wC * uniforms.dilations[1];

                 if (xC >= 0 && xC < uniforms.xShape[2]) {
                   let val = getX(b, xR, xC, d) + getW(wR, wC, d);
                   if (val > curVal) {
                     curVal = val;
                     wRMax = wR;
                     wCMax = wC;
                   }
                 }
               }
             }
           }

           let flatIndexIn = d + uniforms.wShape[2] * (wCMax + wRMax * uniforms.wShape[1]);
           let value = getDy(b, r, c, d);
           ${S("&result[flatIndexIn]","value",this.type)}
         }
       }
     `}}let rP={kernelName:m.Dilation2DBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,dy:o}=t,{strides:n,pad:u,dilations:l}=r,d=m.backend_util.computeDilation2DInfo(a.shape,s.shape,n,u,"NHWC",l),h=s.dtype,p=new r$(d,s.shape,h),c=[{type:"int32",data:[d.filterHeight,d.filterWidth]},{type:"int32",data:[d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.strideHeight,d.strideWidth]},{type:"int32",data:[d.dilationHeight,d.dilationWidth]},{type:"int32",data:[m.util.sizeFromShape(d.outShape)]}],f=eH({backend:i,attrs:{shape:s.shape,value:0,dtype:h}});return i.runWebGPUProgram(p,[a,s,o],h,c,f)}},rz={kernelName:m.Dilation2DBackpropInput,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,dy:o}=t,{strides:n,pad:u,dilations:l}=r,d=m.backend_util.computeDilation2DInfo(a.shape,s.shape,n,u,"NHWC",l),h=a.dtype,p=new rR(d,h),c=[{type:"int32",data:[d.filterHeight,d.filterWidth]},{type:"int32",data:[d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.strideHeight,d.strideWidth]},{type:"int32",data:[d.dilationHeight,d.dilationWidth]},{type:"int32",data:[m.util.sizeFromShape(d.outShape)]}],f=eH({backend:i,attrs:{shape:d.inShape,value:0,dtype:h}});return i.runWebGPUProgram(p,[a,s,o],h,c,f)}};class rN{constructor(e,t,i){this.variableNames=["Image"],this.uniforms="alpha: f32,",this.workgroupSize=[64,1,1],this.pixelsOpType=l.DRAW,this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.type=t,this.textureFormat=i,this.shaderKey=`draw_${t}_${i}`}getUserCode(){let e;let t="float32"===this.type?"value":"value / 255.0";return e=`
      if (uniforms.numChannels == 1) {
        rgba[0] = ${t};
        rgba[1] = ${t};
        rgba[2] = ${t};
      } else {
        rgba[d] = ${t};
      }`,`
       @group(0) @binding(0) var outImage : texture_storage_2d<${this.textureFormat}, write>;
       ${$("index")} {
         if (index < uniforms.size) {
           var rgba = vec4<f32>(0.0, 0.0, 0.0, uniforms.alpha);
           for (var d = 0; d < uniforms.numChannels; d = d + 1) {
             let value = f32(inBuf[index * uniforms.numChannels + d]);
             ${e}
           }
           rgba.x = rgba.x * rgba.w;
           rgba.y = rgba.y * rgba.w;
           rgba.z = rgba.z * rgba.w;
           let coords = getCoordsFromIndex(index);
           textureStore(outImage, vec2<i32>(coords.yx), rgba);
         }
       }
      `}}let rA={kernelName:m.Draw,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{image:s}=i,{canvas:o,options:n}=a,[u,l]=s.shape.slice(0,2),{imageOptions:d}=n||{},h=(null==d?void 0:d.alpha)||1,p=r.device.features.has("bgra8unorm-storage")?"bgra8unorm":"rgba8unorm",c=[u,l],f=new rN(c,s.dtype,p);o.width=l,o.height=u;let m="webgpu",g=o.getContext(m);g||(g=(t=new OffscreenCanvas(l,u)).getContext(m));let x=3===s.shape.length?s.shape[2]:1;g.configure({device:r.device,format:p,usage:GPUTextureUsage.STORAGE_BINDING,alphaMode:"premultiplied"});let y="int32",w=r.makeTensorInfo(c,y),b=r.tensorMap.get(w.dataId);if(b.resource=g.getCurrentTexture(),b.external=!0,r.runWebGPUProgram(f,[s],y,[{type:"uint32",data:[x]},{type:"float32",data:[h]}],w),t){let e=o.getContext("2d");if(!e)throw Error("Please make sure this canvas has only been used for 2d or webgpu context!");e.drawImage(t,0,0)}return r.disposeData(w.dataId),s}},rD=e6({opType:h.MUL,cpuKernelImpl:tm,supportsComplex:!0}),rF={kernelName:m.Multiply,backendName:"webgpu",kernelFunc:rD};function r_(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tq(a,s,o,"sum",i)}let rT={kernelName:m.Sum,backendName:"webgpu",kernelFunc:r_},rL={kernelName:m.Einsum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{equation:a}=r,{allDims:s,summedDims:o,idDims:n}=m.backend_util.decodeEinsumEquation(a,t.length);m.backend_util.checkEinsumDimSizes(s.length,n,t);let{path:u,steps:l}=m.backend_util.getEinsumComputePath(o,n),d=l.length,h=null,p=s.length,c=[];for(let e=0;e<d;++e){for(let r of l[e]){let e;let{permutationIndices:a,expandDims:s}=m.backend_util.getEinsumPermutation(p,n[r]);m.backend_util.isIdentityPermutation(a)?e=t[r]:(e=tG({inputs:{x:t[r]},backend:i,attrs:{perm:a}}),c.push(e));let o=e.shape.slice();for(let e=0;e<s.length;++e)o.splice(s[e],0,1);m.util.arraysEqual(e.shape,o)||(e=eK({inputs:{x:e},backend:i,attrs:{shape:o}}),c.push(e)),null===h?h=e:(h=rD({inputs:{a:e,b:h},backend:i}),c.push(h))}e<d-1&&(u[e]>=0&&(h=r_({inputs:{x:h},backend:i,attrs:{axis:u[e]-(s.length-p),keepDims:!1}}),c.push(h)),p--)}for(let e of c)e!==h&&i.disposeData(e.dataId);return h}},rE=e4({opType:p.ELU}),rB={kernelName:m.Elu,backendName:"webgpu",kernelFunc:rE},rW={kernelName:m.EluGrad,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i}=e,{dy:r,y:a}=t,s=new eZ(h.ELU_DER,r.shape,a.shape);return i.runWebGPUProgram(s,[r,a],r.dtype)}},rO=e6({opType:h.EQUAL,dtype:"bool",cpuKernelImpl:te}),rU={kernelName:m.Equal,backendName:"webgpu",kernelFunc:rO},rV=e4({opType:p.ERF}),rM={kernelName:m.Erf,backendName:"webgpu",kernelFunc:rV},rG=e4({opType:p.EXP,cpuKernelImpl:tt,dtype:"float32"}),rH={kernelName:m.Exp,backendName:"webgpu",kernelFunc:rG};function rX(e){let{inputs:t,attrs:i,backend:r}=e,{dim:a}=i,{input:s}=t,o=s.shape.length,n=s.shape.slice(),u=a;return a<0&&(m.util.assert(-(o+1)<=a,()=>`Axis must be in the interval [${-(o+1)}, ${o}]`),u=o+a+1),n.splice(u,0,1),eK({inputs:{x:s},backend:r,attrs:{shape:n}})}let rK={kernelName:m.ExpandDims,backendName:"webgpu",kernelFunc:rX},rq=e4({opType:p.EXPM1,cpuKernelImpl:ti}),rY={kernelName:m.Expm1,backendName:"webgpu",kernelFunc:rq};class rj{constructor(e,t){this.variableNames=["real","imag"],this.outputShape=[],this.uniforms="exponentMultiplier : f32, denominator: f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.component=e,this.shaderKey=`fft_${e}`}getUserCode(){let e="real"===this.component?"return real * expR - imag * expI;":"return real * expI + imag * expR;";return`
    fn unaryOpComplex(real: f32, expR: f32, imag: f32, expI: f32) -> f32 {
      ${e}
    }

    fn mulMatDFT(batch: i32, index: i32) -> f32 {
      let indexRatio = f32(index) / f32(uniforms.realShape[1]);
      let exponentMultiplierTimesIndexRatio =
          uniforms.exponentMultiplier * indexRatio;

      var result = 0.0;

      for (var i = 0; i < uniforms.realShape[1]; i = i + 1) {
        // x = (-2|2 * PI / N) * index * i;
        let x = exponentMultiplierTimesIndexRatio * f32(i);
        let expR = cos(x);
        let expI = sin(x);
        let real = getReal(batch, i);
        let imag = getImag(batch, i);

        result = result +
            unaryOpComplex(real, expR, imag, expI) / uniforms.denominator;
      }

      return result;
    }

    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        setOutputAtIndex(index, mulMatDFT(coords[0], coords[1]));
      }
    }
  `}}function rQ(e,t,i){let r=i.tensorMap.get(e.dataId),a=m.util.sizeFromShape(e.shape),s=e.shape[e.shape.length-1],o=[],n=eK({inputs:{x:e},backend:i,attrs:{shape:[a/s,s]}});o.push(n);let u=n.shape,l=new rj("real",u),d=new rj("imag",u),h=[{dataId:r.complexTensorInfos.real.dataId,dtype:r.complexTensorInfos.real.dtype,shape:u},{dataId:r.complexTensorInfos.imag.dataId,dtype:r.complexTensorInfos.imag.dtype,shape:u}],p=t?u[1]:1,c=[{type:"float32",data:[t?2*Math.PI:-2*Math.PI]},{type:"float32",data:[p]}],f=i.runWebGPUProgram(l,h,"float32",c);o.push(f);let g=i.runWebGPUProgram(d,h,"float32",c);o.push(g);let x=e3({inputs:{real:f,imag:g},backend:i});o.push(x);let y=eK({inputs:{x:x},backend:i,attrs:{shape:e.shape}});return o.forEach(e=>i.disposeData(e.dataId)),y}let rZ={kernelName:m.FFT,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{input:r}=t;return rQ(r,!1,i)}};class rJ{constructor(e){this.outputShape=[],this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="flipLeftRight"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let coordX = uniforms.xShape[2] - coords[2] - 1;
          let outputValue = getX(coords[0], coords[1], coordX, coords[3]);
          setOutputAtIndex(index, outputValue);
        }
      }
    `}}let r2={kernelName:m.FlipLeftRight,backendName:"webgpu",kernelFunc:({inputs:e,backend:t})=>{let{image:i}=e,r=new rJ(i.shape);return t.runWebGPUProgram(r,[i],i.dtype)}},r3=e4({opType:p.FLOOR,cpuKernelImpl:tr}),r0={kernelName:m.Floor,backendName:"webgpu",kernelFunc:r3},r1=e6({opType:h.FLOOR_DIV,cpuKernelImpl:ta,dtype:"int32"}),r4={kernelName:m.FloorDiv,backendName:"webgpu",kernelFunc:r1};class r6{constructor(e,t,i=!1){this.pixelsOpType=l.FROM_PIXELS,this.outputShape=[0],this.variableNames=[],this.workgroupSize=[256,1,1],this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[t,1,1]),this.importVideo=i,this.shaderKey=`fromPixels_${this.importVideo}`}getUserCode(){let e=this.importVideo?"textureLoad(src, vec2<i32>(coords.yx));":"textureLoad(src, vec2<i32>(coords.yx), 0)",t=this.importVideo?"texture_external":"texture_2d<f32>";return`
      @binding(1) @group(0) var src: ${t};
      ${$("index")} {
        let flatIndex = index * uniforms.numChannels;
        if (flatIndex < uniforms.size) {
          let coords = getCoordsFromIndex(flatIndex);
          let values = ${e};
          for (var i = 0; i < uniforms.numChannels; i = i + 1) {
            result[flatIndex + i] = i32(floor(255.0 * values[i]));
          }
        }
      }
  `}}let r5={kernelName:m.FromPixels,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:a}=e,{pixels:s}=t,{numChannels:o}=a;if(null==s)throw Error("pixels passed to tf.browser.fromPixels() can not be null");let n="undefined"!=typeof HTMLVideoElement&&s instanceof HTMLVideoElement,u="undefined"!=typeof HTMLImageElement&&s instanceof HTMLImageElement,l="undefined"!=typeof HTMLCanvasElement&&s instanceof HTMLCanvasElement||"undefined"!=typeof OffscreenCanvas&&s instanceof OffscreenCanvas,d="undefined"!=typeof ImageBitmap&&s instanceof ImageBitmap,[h,p]=n?[s.videoWidth,s.videoHeight]:[s.width,s.height],c=[p,h,o],f=(0,m.env)().getBool("WEBGPU_IMPORT_EXTERNAL_TEXTURE")&&n,g=n||u;if(d||l||g){let e;if(f)e=i.device.importExternalTexture({source:s});else{if(g){let e=(0,m.env)().getBool("CANVAS2D_WILL_READ_FREQUENTLY_FOR_GPU");(null==r||e!==r8)&&(r8=e,r=document.createElement("canvas").getContext("2d",{willReadFrequently:r8})),r.canvas.width=h,r.canvas.height=p,r.drawImage(s,0,0,h,p),s=r.canvas}let t=GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING,a=i.textureManager.acquireTexture(c[1],c[0],"rgba8unorm",t);i.queue.copyExternalImageToTexture({source:s},{texture:a},[c[1],c[0]]),e=a}let t=m.util.sizeFromShape(c),a=m.util.computeStrides(c),n=new r6(c,o,f),u=[{type:"uint32",data:[t]},{type:"uint32",data:[o]},{type:"uint32",data:[...a]}],l=i.makeTensorInfo([p,h],"int32");i.tensorMap.get(l.dataId).resource=e;let d=i.runWebGPUProgram(n,[l],"int32",u);return i.disposeData(l.dataId),d}let x=s.data,y=x;if(null!=o&&4!==o){y=new Uint8Array(s.width*s.height*o);let e=x.length,t=0;for(let i=0;i<e;i++)i%4<o&&(y[t++]=x[i])}let w=i.makeTensorInfo(c,"int32",new Int32Array(y));return i.uploadToGPU(w.dataId),w}},r8=(0,m.env)().getBool("CANVAS2D_WILL_READ_FREQUENTLY_FOR_GPU");class r7{constructor(e,t,i,r,a){this.uniforms="varianceEpsilon : f32,",this.workgroupSize=[128,1,1],this.size=!0,this.variableNames=["x","mean","variance"],m.backend_util.assertAndGetBroadcastShape(e,t),m.backend_util.assertAndGetBroadcastShape(e,i),this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),null!=r&&(m.backend_util.assertAndGetBroadcastShape(e,r),this.variableNames.push("offset")),null!=a&&(m.backend_util.assertAndGetBroadcastShape(e,a),this.variableNames.push("scale")),this.offsetShape=r,this.scaleShape=a,this.shaderKey="batchNorm"}getUserCode(){let e="0.0";null!=this.offsetShape&&(e="getOffsetByOutputIndex(index)");let t="1.0";return null!=this.scaleShape&&(t="getScaleByOutputIndex(index)"),`
      ${$("index")} {
        if (index < uniforms.size)
        {
          let xValue = getXByOutputIndex(index);
          let meanValue = getMeanByOutputIndex(index);
          let varianValue = getVarianceByOutputIndex(index);
          let offsetValue = ${e};
          let scaleValue = ${t};
          let inv = scaleValue * inverseSqrt(varianValue + f32(uniforms.varianceEpsilon));
          setOutputAtIndex(index,dot(vec3<f32>(xValue, -meanValue, offsetValue), vec3<f32>(inv, inv, 1.0)));
        }
      }
  `}}let r9={kernelName:m.FusedBatchNorm,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{x:r,scale:a,offset:s,mean:o,variance:n}=e,{varianceEpsilon:u}=t,l=[r,o,n],d=null;null!=s&&(d=s.shape,l.push(s));let h=null;null!=a&&(h=a.shape,l.push(a));let p=new r7(r.shape,o.shape,n.shape,d,h);return i.runWebGPUProgram(p,l,r.dtype,[{type:"float32",data:[u]}])}},ae={kernelName:m.FusedConv2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,bias:o,preluActivationWeights:n}=t,{strides:u,pad:l,dataFormat:d,dilations:h,dimRoundingMode:p,activation:c,leakyreluAlpha:f}=r,g=m.backend_util.convertConv2DDataFormat(d),x=m.backend_util.computeConv2DInfo(a.shape,s.shape,u,h,l,p,!1,g);return ij({x:a,filter:s,convInfo:x,backend:i,bias:o,preluActivationWeights:n,leakyreluAlpha:f,activation:c})}},at={kernelName:m.FusedDepthwiseConv2D,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s,filter:o,bias:n,preluActivationWeights:u}=i,{strides:l,pad:d,dilations:h,dimRoundingMode:p,activation:c,leakyreluAlpha:f}=a,g=h;null==g&&(g=[1,1]),m.util.assert(m.backend_util.eitherStridesOrDilationsAreOne(l,g),()=>`Error in depthwiseConv2d: Either strides or dilations must be 1. Got strides ${l} and dilations '${g}'`);let x=m.backend_util.computeConv2DInfo(s.shape,o.shape,l,g,d,p,!0),y=[s,o],w=null!=n,b=null!=u;w&&y.push(n),b&&y.push(u);let C=[{type:"int32",data:[x.padInfo.top,x.padInfo.left]},{type:"int32",data:[x.inHeight,x.inWidth]}];return x.outHeight>4&&x.outWidth>4&&x.strideWidth<=2&&x.inChannels===x.outChannels&&1===x.dilationHeight&&1===x.dilationWidth&&x.inChannels%4==0?(t=new rm(x,w,c,b),C.push({type:"int32",data:[t.virtualWidth]})):(t=new rg(x,w,c,b),C.push({type:"int32",data:[x.filterHeight]},{type:"int32",data:[x.filterWidth]},{type:"int32",data:[x.strideHeight,x.strideWidth]},{type:"int32",data:[x.dilationHeight,x.dilationWidth]})),"leakyrelu"===c&&(C.push({type:"float32",data:[f]}),t.uniforms+=" alpha : f32,"),r.runWebGPUProgram(t,y,"float32",C)}};class ai{constructor(e,t){this.variableNames=["A","indices"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`gathernd_${e}`,this.sliceDim=e,this.uniforms=`sliceDim : i32, strides : ${k(e)},`}getUserCode(){let e;return e=this.sliceDim>1?"uniforms.strides[j]":"uniforms.strides",`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          var flattenIndex = 0;
          for (var j = 0; j < uniforms.sliceDim; j = j + 1) {
            let indexTemp = i32(round(getIndices(coords[0], j)));
            let strideNum = ${e};
            flattenIndex = flattenIndex + indexTemp * strideNum;
          }

          setOutputAtIndex(index, getA(flattenIndex, coords[1]));
        }
      }
      `}}let ar={kernelName:m.GatherNd,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{params:r,indices:a}=t,s=a.shape,o=s[s.length-1],n=m.util.sizeFromShape(r.shape),[u,l,d,h]=m.backend_util.prepareAndValidate(r,a),p=eK({inputs:{x:a},backend:i,attrs:{shape:[l,o]}}),c=eK({inputs:{x:r},backend:i,attrs:{shape:[m.util.sizeFromShape(r.shape)/d,d]}});if(i.shouldExecuteOnCPU([r,a])||"string"===r.dtype){let e=ts(i.readSync(a.dataId),i.bufferSync(r),r.dtype,l,o,d,h,r.shape,n);return i.makeTensorInfo(u,r.dtype,e.values)}let f=new ai(o,[l,d]),g=[{type:"int32",data:[o]},{type:"int32",data:h}],x=i.runWebGPUProgram(f,[c,p],c.dtype,g),y=eK({inputs:{x:x},backend:i,attrs:{shape:u}});return i.disposeData(p.dataId),i.disposeData(c.dataId),i.disposeData(x.dataId),y}};class aa{constructor(e,t){this.variableNames=["A","indices"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.slice(),this.aShape=e,this.outputShape=t,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="gather"}getUserCode(){let e=function(e){let t=["resRC.x","resRC.y","resRC.z","resRC.w"],i=[];for(let r=0;r<e.length;r++)2===r?i.push("indexZ"):i.push(`${t[r]}`);return i.join()}(this.aShape);return`
      ${$("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          let indexZ = i32(getIndices(resRC.x, resRC.z));
          let inBounds = select(0.0, 1.0, indexZ >= 0 && indexZ < uniforms.aShape[2]);
          setOutputAtIndex(index, inBounds * getA(${e}));
        }
      }
    `}}function as(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,indices:s}=t,{axis:o,batchDims:n}=r,u=m.util.parseAxisParam(o,a.shape)[0],l=m.backend_util.segment_util.collectGatherOpShapeInfo(a,s,u,n),d=m.util.sizeFromShape(s.shape),h=[],p=eK({inputs:{x:a},backend:i,attrs:{shape:[l.batchSize,l.outerSize,l.dimSize,l.sliceSize]}}),c=eK({inputs:{x:s},backend:i,attrs:{shape:[l.batchSize,d/l.batchSize]}});h.push(p),h.push(c);let f=[l.batchSize,l.outerSize,d/l.batchSize,l.sliceSize];if(i.shouldExecuteOnCPU([a,s])){let e=i.tensorMap.get(c.dataId).values,t=(0,m.buffer)(c.shape,c.dtype,e),r=i.tensorMap.get(p.dataId).values,a=to((0,m.buffer)(p.shape,p.dtype,r),t,f);return h.forEach(e=>i.disposeData(e.dataId)),i.makeTensorInfo(l.outputShape,a.dtype,a.values)}let g=new aa(p.shape,f),x=i.runWebGPUProgram(g,[p,c],p.dtype);h.push(x);let y=eK({inputs:{x:x},backend:i,attrs:{shape:l.outputShape}});return h.forEach(e=>i.disposeData(e.dataId)),y}let ao={kernelName:m.GatherV2,backendName:"webgpu",kernelFunc:as},an=e6({opType:h.GREATER,cpuKernelImpl:tu,dtype:"bool"}),au={kernelName:m.Greater,backendName:"webgpu",kernelFunc:an},al=e6({opType:h.GREATER_EQUAL,dtype:"bool",cpuKernelImpl:tn}),ad={kernelName:m.GreaterEqual,backendName:"webgpu",kernelFunc:al},ah={kernelName:m.IFFT,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{input:r}=t;return rQ(r,!0,i)}},ap=e4({opType:p.IS_FINITE,dtype:"bool"}),ac={kernelName:m.IsFinite,backendName:"webgpu",kernelFunc:ap},af=e4({opType:p.IS_INF,dtype:"bool"}),am={kernelName:m.IsInf,backendName:"webgpu",kernelFunc:af},ag=e4({opType:p.IS_NAN,dtype:"bool"}),ax={kernelName:m.IsNan,backendName:"webgpu",kernelFunc:ag},ay={kernelName:m.LeakyRelu,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{alpha:s}=r,o=new e1(a.shape,p.LEAKYRELU,"alpha : f32,");return i.runWebGPUProgram(o,[a],"float32",[{type:"float32",data:[s]}])}},aw=e6({opType:h.LESS,dtype:"bool",cpuKernelImpl:td}),ab={kernelName:m.Less,backendName:"webgpu",kernelFunc:aw},aC=e6({opType:h.LESS_EQUAL,dtype:"bool",cpuKernelImpl:tl}),aS={kernelName:m.LessEqual,backendName:"webgpu",kernelFunc:aC};class av{constructor(e){this.variableNames=[],this.outputShape=[],this.uniforms="start : f32, step : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="linSpace"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          setOutputAtIndex(index, uniforms.start + f32(index) * uniforms.step);
        }
      }
    `}}let aI={kernelName:m.LinSpace,backendName:"webgpu",kernelFunc:function(e){let{backend:t,attrs:i}=e,{start:r,stop:a,num:s}=i,o=(a-r)/(s-1),n=new av(s);return t.runWebGPUProgram(n,[],"float32",[{type:"float32",data:[r]},{type:"float32",data:[o]}])}},ak=e4({opType:p.LOG,cpuKernelImpl:th}),aR={kernelName:m.Log,backendName:"webgpu",kernelFunc:ak},a$=e4({opType:p.LOG1P}),aP={kernelName:m.Log1p,backendName:"webgpu",kernelFunc:a$},az=e6({opType:h.LOGICAL_AND,dtype:"bool"}),aN={kernelName:m.LogicalAnd,backendName:"webgpu",kernelFunc:az},aA=e4({opType:p.LOGICAL_NOT}),aD={kernelName:m.LogicalNot,backendName:"webgpu",kernelFunc:aA},aF=e6({opType:h.LOGICAL_OR}),a_={kernelName:m.LogicalOr,backendName:"webgpu",kernelFunc:aF},aT=`
  var powValue = 0.0;
  let basis = uniforms.bias + uniforms.alpha * sum;
  if (uniforms.beta == 0.5) {
    powValue = inverseSqrt(basis);
  } else if (uniforms.beta == 1.0) {
    powValue = 1.0 / basis;
  } else {
    powValue = exp(log(basis) * (-uniforms.beta));
  }
`;class aL{constructor(e){this.outputShape=[],this.variableNames=["x"],this.uniforms="radius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="lrn"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let b = coords[0];
        let r = coords[1];
        let c = coords[2];
        let d = coords[3];

        let x = getX(b, r, c, d);
        var sum = 0.0;
        for (var i = -uniforms.radius; i <= uniforms.radius; i = i + 1) {
          let idx = d + i;
          if (idx >= 0 && idx < uniforms.xShape[3]) {
            let z = getX(b, r, c, idx);
            sum = sum + z * z;
          }
        }
        ${aT}

        setOutputAtIndex(index, x * powValue);
      }
    }
  `}}class aE{constructor(e,t){this.outputShape=[],this.variableNames=["x"],this.uniforms="radius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[256,1,1],this.maxAllowRadius=16,m.util.assert(t<=this.maxAllowRadius,()=>`Radius must be less than or equal to ${this.maxAllowRadius}, current radius is ${t}`),this.outputShape=e,this.elementsPerWorkgroup=this.workgroupSize[0]-2*this.maxAllowRadius,this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=E(this.dispatchLayout,this.outputShape,[this.elementsPerWorkgroup,this.workgroupSize[1],this.workgroupSize[2]]),this.shaderKey="lrn_shared"}getUserCode(){return`
    var <workgroup>lrnSub: array<f32, ${this.workgroupSize[0]}>;
    const elementsPerWorkgroup = ${this.elementsPerWorkgroup};
    const maxAllowRadius = ${this.maxAllowRadius};

    ${$()} {
      let localDepth = i32(localId.x);
      let workgroupDepth = i32(workgroupId.x) * elementsPerWorkgroup;
      let xDepth = workgroupDepth + localDepth - maxAllowRadius;
      let b = i32(globalId.z) / uniforms.xShape[1];
      let r = i32(globalId.z) - b * uniforms.xShape[1];
      let c = i32(globalId.y);
      let d = workgroupDepth + localDepth;

      var x = 0.0;
      if (xDepth >= 0 && xDepth < uniforms.xShape[3]) {
        x = getX(b, r, c, xDepth);
      }
      lrnSub[localDepth] = x;
      workgroupBarrier();

      if (localDepth < elementsPerWorkgroup && d < uniforms.outShape[3]) {
        var sum = 0.0;
        let index = localDepth + maxAllowRadius;
        for (var i = -uniforms.radius; i <= uniforms.radius; i = i + 1) {
          let z = lrnSub[index + i];
          sum = sum + z * z;
        }
        ${aT}

        setOutputAtCoords(b, r, c, d, lrnSub[index] * powValue);
      }
    } `}}let aB={kernelName:m.LRN,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{depthRadius:o,bias:n,alpha:u,beta:l}=a;t=o>16?new aL(s.shape):new aE(s.shape,o);let d=[{type:"int32",data:[o]},{type:"float32",data:[n]},{type:"float32",data:[u]},{type:"float32",data:[l]}];return r.runWebGPUProgram(t,[s],s.dtype,d)}};class aW{constructor(e){this.outputShape=[],this.variableNames=["inputImage","outputImage","dy"],this.uniforms="depthRadius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="lrn_grad"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let b = coords[0];
        let r = coords[1];
        let c = coords[2];

        let MIN_DEPTH_BEGIN = 0;
        let MAX_DEPTH_END = uniforms.outShape[3];
        var result = 0.0;
        for (var d = MIN_DEPTH_BEGIN; d < MAX_DEPTH_END; d++) {
          let depthBegin = max(MIN_DEPTH_BEGIN, d - uniforms.depthRadius);
          let depthEnd = min(MAX_DEPTH_END, d + uniforms.depthRadius + 1);

          var norm = 0.0;
          for (var k = MIN_DEPTH_BEGIN; k < MAX_DEPTH_END; k++) {
            if (k < depthBegin) {
              continue;
            } else if (k >= depthBegin && k < depthEnd) {
              norm += getInputImage(b, r, c, k) * getInputImage(b, r, c, k);
            } else {
              break;
            }
          }

          norm = uniforms.alpha * norm + uniforms.bias;

          for (var k = MIN_DEPTH_BEGIN; k < MAX_DEPTH_END; k++) {
            if (k < depthBegin) {
              continue;
            } else if (k >= depthBegin && k < depthEnd) {
              var dyi = -2.0 * uniforms.alpha * uniforms.beta
                * getInputImage(b, r, c, k) * getOutputImage(b, r, c, d) / norm;
              if (k == d) {
                dyi += pow(norm, -1.0 * uniforms.beta);
              }
              if (k == coords[3]) {
                dyi *= getDy(b, r, c, d);
                result += dyi;
              }
            } else {
              break;
            }
          }
        }

        setOutputAtIndex(index, result);
      }
    }
  `}}let aO={kernelName:m.LRNGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,y:s,dy:o}=t,{depthRadius:n,bias:u,alpha:l,beta:d}=r,h=new aW(a.shape);return i.runWebGPUProgram(h,[a,s,o],a.dtype,[{type:"int32",data:[n]},{type:"float32",data:[u]},{type:"float32",data:[l]},{type:"float32",data:[d]}])}},aU=e6({opType:h.MAX,cpuKernelImpl:tc}),aV={kernelName:m.Maximum,backendName:"webgpu",kernelFunc:aU},aM={kernelName:m.MaxPool,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dimRoundingMode:u}=r,l=m.backend_util.computePool2DInfo(a.shape,s,o,1,n,u);return iu(a,l,"max",i)}},aG={kernelName:m.MaxPool3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dataFormat:u,dimRoundingMode:l}=r,d=m.backend_util.computePool3DInfo(a.shape,s,o,[1,1,1],n,l,u),h=new ii(d,"max"),p=[{type:"int32",data:[d.strideDepth,d.strideHeight,d.strideWidth]},{type:"int32",data:[d.padInfo.front,d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.inDepth,d.inHeight,d.inWidth]},{type:"int32",data:[d.effectiveFilterDepth,d.effectiveFilterHeight,d.effectiveFilterWidth]}];return i.runWebGPUProgram(h,[a],a.dtype,p)}};class aH{constructor(e){this.variableNames=["dy","maxPos"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="maxPool2DBackprop"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d = coords[3];

        let dyRCCorner = vec2<i32>(coords.yz) - uniforms.pads;
        let dyRCorner = dyRCCorner.x;
        let dyCCorner = dyRCCorner.y;

        // Convolve dy(?, ?, d) with pos mask(:, :, d) to get dx(xR, xC, d).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        let lastIndex = uniforms.filterDims[0] * uniforms.filterDims[1] - 1;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR += uniforms.dilations[0]) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims[1]; wC += uniforms.dilations[1]) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }
            let idyC = i32(dyC);

            let dyValue = getDy(batch, idyR, idyC, d);
            let maxPosValue = lastIndex - i32(getMaxPos(batch, idyR, idyC, d));

            // Get the current value, check it against the value from the
            // position matrix.
            let curPosValue = wR * uniforms.filterDims[1] + wC;
            let mask = select(0.0, 1.0, maxPosValue == curPosValue);
            dotProd += dyValue * mask;
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class aX{constructor(e){this.variableNames=["dy","maxPos"],this.uniforms=`strides : vec3<i32>, pads : vec3<i32>, filterDims : vec3<i32>,
      outDepth : i32, outHeight : i32, outWidth : i32`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="maxPool3DBackprop"}getUserCode(){return`
      ${$("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let ch = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyDCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        // Convolve dy(?, ?, ?, ch) with pos mask(:, :, :, d) to get
        // dx(xD, xR, xC, ch).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        let lastIndex = uniforms.filterDims[0] * uniforms.filterDims[1] * uniforms.filterDims[2] - 1;

        for (var wD = 0; wD < uniforms.filterDims[0]; wD++) {
          let dyD = f32(dyDCorner + wD) / f32(uniforms.strides[0]);

          if (dyD < 0.0 || dyD >= f32(uniforms.outDepth) || fract(dyD) > 0.0) {
            continue;
          }
          let idyD = i32(dyD);

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let dyValue = getDy(batch, idyD, idyR, idyC, ch);
              let maxPosValue = lastIndex - i32(getMaxPos(batch, idyD, idyR, idyC, ch));

              // Get the current value, check it against the value from the
              // position matrix.
              let curPosValue = wD * uniforms.filterDims[1] * uniforms.filterDims[2] + wR * uniforms.filterDims[2] + wC;
              let mask = select(0.0, 1.0, maxPosValue == curPosValue);
              dotProd += dyValue * mask;
            }
          }
        }

        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let aK={kernelName:m.MaxPool3DGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t,{filterSize:o,strides:n,pad:u,dimRoundingMode:l}=r,d=m.backend_util.computePool3DInfo(s.shape,o,n,[1,1,1],u,l),h=new ii(d,"max",!0),p=[{type:"int32",data:[d.strideDepth,d.strideHeight,d.strideWidth]},{type:"int32",data:[d.padInfo.front,d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.inDepth,d.inHeight,d.inWidth]},{type:"int32",data:[d.effectiveFilterDepth,d.effectiveFilterHeight,d.effectiveFilterWidth]}],c=i.runWebGPUProgram(h,[s],"int32",p),f=new aX(d);p=[{type:"int32",data:[d.strideDepth,d.strideHeight,d.strideWidth]},{type:"int32",data:[d.effectiveFilterDepth-1-d.padInfo.front,d.effectiveFilterHeight-1-d.padInfo.top,d.effectiveFilterWidth-1-d.padInfo.left]},{type:"int32",data:[d.effectiveFilterDepth,d.effectiveFilterHeight,d.effectiveFilterWidth]},{type:"int32",data:[d.outDepth]},{type:"int32",data:[d.outHeight]},{type:"int32",data:[d.outWidth]}];let g=i.runWebGPUProgram(f,[a,c],s.dtype,p);return i.disposeData(c.dataId),g}},aq={kernelName:m.MaxPoolGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s,output:o}=t;G([s,o],"maxPoolGrad");let{filterSize:n,strides:u,pad:l,dimRoundingMode:d}=r,h=m.backend_util.computePool2DInfo(s.shape,n,u,1,l,d),p=new it(h,"max",!0),c=[{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.dilationHeight,h.dilationWidth]},{type:"int32",data:[h.inHeight,h.inWidth]},{type:"int32",data:[h.effectiveFilterHeight,h.effectiveFilterWidth]}],f=i.runWebGPUProgram(p,[s],"int32",c),g=new aH(h);c=[{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.effectiveFilterHeight-1-h.padInfo.top,h.effectiveFilterWidth-1-h.padInfo.left]},{type:"int32",data:[h.dilationHeight,h.dilationWidth]},{type:"int32",data:[h.effectiveFilterHeight,h.effectiveFilterWidth]},{type:"int32",data:[h.outHeight]},{type:"int32",data:[h.outWidth]}];let x=i.runWebGPUProgram(g,[a,f],s.dtype,c);return i.disposeData(f.dataId),x}},aY={kernelName:m.MaxPoolWithArgmax,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{filterSize:a,strides:s,pad:o,includeBatchInIndex:n}=r,{x:u}=t;m.util.assert(4===u.shape.length,()=>`Error in maxPool: input must be rank 4 but got rank ${u.shape.length}.`);let l=[1,1];m.util.assert(m.backend_util.eitherStridesOrDilationsAreOne(s,l),()=>`Error in maxPool: Either strides or dilations must be 1. Got strides ${s} and dilations '${l}'`);let d=m.backend_util.computePool2DInfo(u.shape,a,s,l,o),h=[{type:"int32",data:[d.strideHeight,d.strideWidth]},{type:"int32",data:[d.padInfo.top,d.padInfo.left]},{type:"int32",data:[d.dilationHeight,d.dilationWidth]},{type:"int32",data:[d.inHeight,d.inWidth]},{type:"int32",data:[d.effectiveFilterHeight,d.effectiveFilterWidth]}],p=new it(d,"max",!1),c=i.runWebGPUProgram(p,[u],u.dtype,h);return p=new it(d,"max",!0,!0,n),[c,i.runWebGPUProgram(p,[u],"int32",h)]}},aj={kernelName:m.Min,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tq(a,s,o,"min",i)}},aQ=e6({opType:h.MIN,cpuKernelImpl:tf}),aZ={kernelName:m.Minimum,backendName:"webgpu",kernelFunc:aQ};class aJ{constructor(e,t,i){this.uniforms="",this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t.map((t,i)=>t[0]+e[i]+t[1]),this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.xShape=e,t.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.offset="reflect"===i?0:1,this.shaderKey=`mirrorPad_${i}`}getUserCode(){let e=this.xShape.length,t=this.xShape.map((e,t)=>`uniforms.pad${t}[0]`).join(","),i=this.xShape.map((t,i)=>`uniforms.pad${i}[0] + uniforms.xShape${e>1?`[${i}]`:""}`).join(","),r=1===e?"start":"start[i]",a=1===e?"end":"end[i]",s=1===e?"outC":"outC[i]",o=k(e),n=e>1?["coords[0]","coords[1]","coords[2]","coords[3]"].slice(0,e):"coords";return`
      ${$("index")} {
        if (index < uniforms.size) {
          let start = ${o}(${t});
          let end = ${o}(${i});
          var outC = getCoordsFromIndex(index);
          for (var i = 0; i < ${e}; i = i + 1) {
            if (${s} < ${r}) {
              ${s} = ${r} * 2 - ${s} - ${this.offset};
            } else if(${s} >= ${a}) {
              ${s} = (${a} - 1) * 2 - ${s} + ${this.offset};
            }
          }
          let coords = outC - start;
          setOutputAtIndex(index, getX(${n}));
        }
      }
    `}}let a2={kernelName:m.MirrorPad,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{x:r}=e,{paddings:a,mode:s}=t,o=a.map(e=>({type:"int32",data:[e[0],e[1]]})),n=new aJ(r.shape,a,s);return i.runWebGPUProgram(n,[r],r.dtype,o)}},a3=e6({opType:h.MOD}),a0={kernelName:m.Mod,backendName:"webgpu",kernelFunc:a3};class a1{constructor(e,t){this.variableNames=["probs"],this.outputShape=[],this.uniforms="seed : f32, numOutcomes: i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,t],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="multinomial"}getUserCode(){return`
    //Based on the work of Dave Hoskins
    //https://www.shadertoy.com/view/4djSRW
    fn random (seed : f32, resultUV : vec2<f32>) -> f32 {
      let HASHSCALE1 = 443.8975;
      let p = resultUV * seed;
      var p3  = fract(vec3<f32>(p.xyx) * HASHSCALE1);
      p3 = p3 + dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
    }

    ${$("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let batch = coords[0];

        let resUV = vec2<f32>(f32(coords[1]) / f32(uniforms.outShape[1]),
            f32(coords[0]) / f32(uniforms.outShape[0]));
        let r = random(uniforms.seed, resUV);
        var cdf = 0.0;
        for (var i = 0; i < uniforms.numOutcomes - 1; i = i + 1) {
          cdf = cdf + getProbs(batch, i);

          if (r < cdf) {
            setOutputAtIndexI32(index, i);
            return;
          }
        }

        // If no other event happened, last event happened.
        setOutputAtIndexI32(index, uniforms.numOutcomes - 1);
      }
    }
  `}}class a4{constructor(e){this.variableNames=["logits"],this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=[this.outputShape[0],1,1],this.outputShape[1]>=4096?this.workgroupSize=[256,1,1]:this.workgroupSize=[64,1,1],this.shaderKey="softmax"}getUserCode(){return`
    var<workgroup> buf : array<f32, ${this.workgroupSize[0]}>;
    var<workgroup> rowMaxShared : f32;
    var<workgroup> rowSumShared : f32;
    const blockSize = ${this.workgroupSize[0]};
    ${$("index")} {
      let row = index / blockSize;
      let tid = i32(localId.x);
      let cols = uniforms.outShape[1];

      var threadMax = -3.402823e+38f;
      for (var col = tid; col < cols; col += blockSize) {
        let value = getLogits(row, col);
        threadMax = max(threadMax, value);
      }
      if (tid < cols) {
        buf[tid] = threadMax;
      }
      workgroupBarrier();

      var reduceSize = min(cols, blockSize);
      for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
        reduceSize = currSize + (reduceSize & 1);
        if (tid < currSize) {
          buf[tid] = max(buf[tid], buf[tid + reduceSize]);
        }
        workgroupBarrier();
      }

      if (tid == 0) {
        rowMaxShared = buf[0];
      }
      workgroupBarrier();

      var threadSum = 0.0;
      for (var col = tid; col < cols; col += blockSize) {
        let subExp = exp(getLogits(row, col) - rowMaxShared);
        threadSum += subExp;
      }
      buf[tid] = threadSum;
      workgroupBarrier();

      for (var currSize = blockSize >> 1;  currSize > 0; currSize = currSize >> 1) {
        if (tid < currSize) {
          buf[tid] = buf[tid] + buf[tid + currSize];
        }
        workgroupBarrier();
      }

      if (tid == 0) {
        rowSumShared = buf[0];
      }
      workgroupBarrier();

      for (var col = tid; col < cols; col += blockSize) {
        let value = exp(getLogits(row, col) - rowMaxShared) / rowSumShared;
        setOutputAtCoords(row, col, value);
      }
  }
    `}}function a6(e){let{inputs:t,backend:i,attrs:r}=e,{logits:a}=t,{dim:s}=r,o=eK({inputs:{x:a},backend:i,attrs:{shape:[m.util.sizeFromShape(a.shape)/a.shape[s],a.shape[s]]}}),n=new a4(o.shape),u=i.runWebGPUProgram(n,[o],a.dtype),l=eK({inputs:{x:u},backend:i,attrs:{shape:a.shape}});return i.disposeData(o.dataId),i.disposeData(u.dataId),l}let a5={kernelName:m.Softmax,backendName:"webgpu",kernelFunc:a6},a8={kernelName:m.Multinomial,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{logits:a}=t,{numSamples:s,seed:o,normalized:n}=r,u=n?a:a6({inputs:{logits:a},backend:i,attrs:{dim:a.shape.length-1}}),l=u.shape[0],d=u.shape[1],h=new a1(l,s),p=i.runWebGPUProgram(h,[u],"int32",[{type:"float32",data:[o]},{type:"int32",data:[d]}]);return n||i.disposeData(u.dataId),p}},a7={kernelName:m.Neg,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t;if(i.shouldExecuteOnCPU([r])){let[e,t]=tg(i.tensorMap.get(r.dataId).values,r.shape,r.dtype);return i.makeTensorInfo(t,r.dtype,e)}let a=new e1(r.shape,p.NEG);return i.runWebGPUProgram(a,[r],r.dtype)}},a9={kernelName:m.NonMaxSuppressionV3,backendName:"webgpu",kernelFunc:function(e){console.warn("tf.nonMaxSuppression() in webgpu locks the UI thread. Call tf.nonMaxSuppressionAsync() instead");let{inputs:t,backend:i,attrs:r}=e,{boxes:a,scores:s}=t,{maxOutputSize:o,iouThreshold:n,scoreThreshold:u}=r,l=i.readSync(a.dataId),d=i.readSync(s.dataId),{selectedIndices:h}=m.kernel_impls.nonMaxSuppressionV3Impl(l,d,o,n,u);return i.makeTensorInfo([h.length],"int32",new Int32Array(h))}},se={kernelName:m.NonMaxSuppressionV5,backendName:"webgpu",kernelFunc:function(e){console.warn("tf.nonMaxSuppression() in webgpu locks the UI thread. Call tf.nonMaxSuppressionAsync() instead");let{inputs:t,backend:i,attrs:r}=e,{boxes:a,scores:s}=t,{maxOutputSize:o,iouThreshold:n,scoreThreshold:u,softNmsSigma:l}=r,d=i.readSync(a.dataId),h=i.readSync(s.dataId),{selectedIndices:p,selectedScores:c}=m.kernel_impls.nonMaxSuppressionV5Impl(d,h,o,n,u,l);return[i.makeTensorInfo([p.length],"int32",new Int32Array(p)),i.makeTensorInfo([c.length],"float32",new Float32Array(c))]}};class st{constructor(e,t){this.variableNames=["x"],this.uniforms="onValue : f32, offValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,t],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="onehot"}getUserCode(){return`
      ${$("index")} {
        if(index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          setOutputAtIndex(index, mix(uniforms.offValue, uniforms.onValue,
                                      f32(i32(round(getX(coords.x))) == coords.y)));
        }
      }
    `}}let si={kernelName:m.OneHot,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{indices:a}=t,{dtype:s,depth:o,onValue:n,offValue:u}=r,l=m.util.sizeFromShape(a.shape),d=new st(l,o),h=eK({inputs:{x:a},backend:i,attrs:{shape:[l]}}),p=i.runWebGPUProgram(d,[h],s,[{type:"float32",data:[n]},{type:"float32",data:[u]}]);i.disposeData(h.dataId);let c=eK({inputs:{x:p},backend:i,attrs:{shape:[...a.shape,o]}});return i.disposeData(p.dataId),c}};function sr(e){let{inputs:t,backend:i}=e,{x:r}=t;if("complex64"!==r.dtype)return eH({attrs:{shape:r.shape,dtype:r.dtype,value:"string"===r.dtype?"":0},backend:i});{let e=iN({inputs:{input:r},backend:i}),t=sr({inputs:{x:e},backend:i}),a=iV({inputs:{input:r},backend:i}),s=sr({inputs:{x:a},backend:i}),o=e3({inputs:{real:t,imag:s},backend:i});return i.disposeData(e.dataId),i.disposeData(t.dataId),i.disposeData(a.dataId),i.disposeData(s.dataId),o}}let sa={kernelName:m.ZerosLike,backendName:"webgpu",kernelFunc:sr},ss={kernelName:m.OnesLike,backendName:"webgpu",kernelFunc:function e(t){let{inputs:i,backend:r}=t,{x:a}=i;if("string"===a.dtype)throw Error("onesLike is not supported under string dtype");if("complex64"!==a.dtype)return eH({attrs:{shape:a.shape,dtype:a.dtype,value:1},backend:r});{let t=iN({inputs:{input:a},backend:r}),i=e({inputs:{x:t},backend:r}),s=iV({inputs:{input:a},backend:r}),o=sr({inputs:{x:s},backend:r}),n=e3({inputs:{real:i,imag:o},backend:r});return r.disposeData(t.dataId),r.disposeData(i.dataId),r.disposeData(s.dataId),r.disposeData(o.dataId),n}}},so={kernelName:m.Pack,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{axis:a}=r;if(1===t.length)return rX({inputs:{input:t[0]},backend:i,attrs:{dim:a}});let s=t[0].shape,o=t[0].dtype;t.forEach(e=>{m.util.assertShapesMatch(s,e.shape,"All tensors passed to stack must have matching shapes"),m.util.assert(o===e.dtype,()=>"All tensors passed to stack must have matching dtypes")});let n=[],u=iG({inputs:t.map(e=>{let t=rX({inputs:{input:e},backend:i,attrs:{dim:a}});return n.push(t),t}),backend:i,attrs:{axis:a}});return n.forEach(e=>i.disposeData(e.dataId)),u}};function sn(e,t=!1){let i=e.length,r=k(i),a=e.map((e,t)=>`uniforms.pad${t}[0]`).join(","),s=e.map((e,t)=>`uniforms.pad${t}[0] + uniforms.xShape${i>1?`[${t}]`:""}`).join(","),o=i>1?`${r}(${a})`:`${a}`,n=i>1?`${r}(${s})`:`${s}`,u=i>1?"any(paddedCoords < start)":"paddedCoords < start",l=i>1?"any(paddedCoords >= end)":"paddedCoords >= end",d=i>1?["coords[0]","coords[1]","coords[2]","coords[3]"].slice(0,i):"coords";return`
        let start = ${o};
        let end = ${n};
        if (${u} || ${l}) {
          setOutputAtIndex(index, ${t?0:"uniforms.constantValue"});
        } else {
          let coords = paddedCoords - start;
          setOutputAtIndex(index, getX(${d}));
        }
  `}class su{constructor(e,t){this.variableNames=["x"],this.uniforms="constantValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t.map((t,i)=>t[0]+e[i]+t[1]),this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),t.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.xShape=e,this.shaderKey="pad"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let paddedCoords = getCoordsFromIndex(index);
          ${sn(this.xShape)}
        }
      }
    `}}let sl={kernelName:m.PadV2,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{paddings:s,constantValue:o}=r;if(s.every(e=>m.util.arraysEqual(e,[0,0])))return eJ({inputs:{x:a},backend:i});if(0===m.util.sizeFromShape(a.shape))return eH({backend:i,attrs:{shape:s.map((e,t)=>e[0]+a.shape[t]+e[1]),value:o,dtype:a.dtype}});let n=[{type:"float32",data:[o]}];s.map(e=>n.push({type:"int32",data:[e[0],e[1]]}));let u=new su(a.shape,s);return i.runWebGPUProgram(u,[a],a.dtype,n)}},sd=e6({opType:h.POW}),sh={kernelName:m.Pow,backendName:"webgpu",kernelFunc:sd},sp={kernelName:m.Prelu,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r,alpha:a}=t,s=new eZ(h.PRELU,r.shape,a.shape);return i.runWebGPUProgram(s,[r,a],"float32")}},sc={kernelName:m.Prod,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tq(a,s,o,"prod",i)}},sf={kernelName:m.Range,backendName:"webgpu",kernelFunc:e=>{let{backend:t,attrs:i}=e,{start:r,stop:a,step:s,dtype:o}=i,n=tw(r,a,s,o);return t.makeTensorInfo([n.length],o,n)}},sm=e6({opType:h.DIV}),sg={kernelName:m.RealDiv,backendName:"webgpu",kernelFunc:sm},sx=e4({opType:p.RECIPROCAL}),sy={kernelName:m.Reciprocal,backendName:"webgpu",kernelFunc:sx},sw=e4({opType:p.RELU}),sb={kernelName:m.Relu,backendName:"webgpu",kernelFunc:sw},sC=e4({opType:p.RELU6}),sS={kernelName:m.Relu6,backendName:"webgpu",kernelFunc:sC};class sv{constructor(e,t,i){this.variableNames=["x"],this.uniforms="adjustHeightWidth : vec2<f32>, halfPixelCenters : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e[0],t,i,e[3]],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="resizeBilinear"}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let d = coords[3];
          let rc = coords.yz;

          let effectiveInSize = vec2<f32>(
            f32(uniforms.xShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.xShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveOutSize = vec2<f32>(
            f32(uniforms.outShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.outShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveInputOverOutputRatioRC =
              effectiveInSize / effectiveOutSize;

          // Fractional source index
          let sourceFracIndexRC =
            (vec2<f32>(rc) + vec2<f32>(uniforms.halfPixelCenters)) *
            effectiveInputOverOutputRatioRC - vec2<f32>(uniforms.halfPixelCenters);

          // Compute the four integer indices.
          let sourceFloorRC = vec2<i32>(sourceFracIndexRC);
          let sourceCeilRC = vec2<i32>(
            min(vec2<f32>(uniforms.xShape.yz) - vec2<f32>(1.0), ceil(sourceFracIndexRC)));

          let topLeft = getX(b, sourceFloorRC.x, sourceFloorRC.y, d);
          let bottomLeft = getX(b, sourceCeilRC.x, sourceFloorRC.y, d);
          let topRight = getX(b, sourceFloorRC.x, sourceCeilRC.y, d);
          let bottomRight = getX(b, sourceCeilRC.x, sourceCeilRC.y, d);

          let fracRC = sourceFracIndexRC - vec2<f32>(sourceFloorRC);

          let top = topLeft + (topRight - topLeft) * fracRC.y;
          let bottom = bottomLeft + (bottomRight - bottomLeft) * fracRC.y;
          let newValue = top + (bottom - top) * fracRC.x;

          setOutputAtIndex(index, newValue);
        }
      }
    `}}let sI={kernelName:m.ResizeBilinear,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a}=t,{alignCorners:s,size:o,halfPixelCenters:n}=r,[u,l]=o,d=s&&u>1?1:0,h=s&&l>1?1:0,p=new sv(a.shape,u,l);return i.runWebGPUProgram(p,[a],"float32",[{type:"float32",data:[d,h]},{type:"float32",data:[n?.5:0]}])}};class sk{constructor(e,t){this.variableNames=["dy"],this.uniforms=`effectiveXSize : vec2<i32>, effectiveYSize : vec2<i32>, heightScale : f32, widthScale : f32,
       invHeightScale : f32, invWidthScale : f32, winHeight : i32, winWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.alignCorners=t,this.shaderKey=`resizeBilinearBackprop_${t}`}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let b = coords[0];
          let d = coords[3];
          let r = coords[1];
          let c = coords[2];

          var accumulator = 0.0;

          // Compute bounds for where in dy we will look
          let startRLerp = floor(f32(r) * uniforms.invHeightScale);
          let startDyR = i32(startRLerp - f32(uniforms.winHeight / 2));

          let startCLerp = floor(f32(c) * uniforms.invWidthScale);
          let startDyC = i32(startCLerp - f32(uniforms.winWidth / 2));

          // Loop over dy
          for (var dyROffset = 0; dyROffset < uniforms.winHeight; dyROffset++) {
            let dyR = startDyR + dyROffset;

            // Guard against the window exceeding the bounds of dy
            if (dyR < 0 || dyR >= uniforms.dyShape[1]) {
              continue;
            }

            for (var dyCOffset = 0; dyCOffset < uniforms.winWidth; dyCOffset++) {
              let dyC = startDyC + dyCOffset;

              // Guard against the window exceeding the bounds of dy
              if (dyC < 0 || dyC >= uniforms.dyShape[2]) {
                continue;
              }

              let dxR = f32(dyR) * uniforms.heightScale;
              let topDxRIndex = i32(floor(dxR));
              let bottomDxRIndex = i32(min(ceil(dxR), f32(uniforms.outShape[1] - 1)));
              let dxRLerp = dxR - f32(topDxRIndex);
              let inverseDxRLerp = 1.0 - dxRLerp;

              let dxC = f32(dyC) * uniforms.widthScale;
              let leftDxCIndex = i32(floor(dxC));
              let rightDxCIndex = i32(min(ceil(dxC), f32(uniforms.outShape[2] - 1)));
              let dxCLerp = dxC - f32(leftDxCIndex);
              let inverseDxCLerp = 1.0 - dxCLerp;

              if (r == topDxRIndex && c == leftDxCIndex) {
                // topLeft
                accumulator +=
                  getDy(b, dyR, dyC, d) * inverseDxRLerp * inverseDxCLerp;
              }

              if (r == topDxRIndex && c == rightDxCIndex) {
                // topRight
                accumulator += getDy(b, dyR, dyC, d) * inverseDxRLerp * dxCLerp;
              }

              if (r == bottomDxRIndex && c == leftDxCIndex) {
                // bottomLeft
                accumulator += getDy(b, dyR, dyC, d) * dxRLerp * inverseDxCLerp;
              }

              if (r == bottomDxRIndex && c == rightDxCIndex) {
                // bottomRight
                accumulator += getDy(b, dyR, dyC, d) * dxRLerp * dxCLerp;
              }
            }
          }
          // End loop over dy

          setOutputAtIndex(index, accumulator);
        }
      }
    `}}let sR={kernelName:m.ResizeBilinearGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a,dy:s}=t,{alignCorners:o}=r,[,n,u]=a.shape,[,l,d]=s.shape,h=[o&&l>1?n-1:n,o&&d>1?u-1:u],p=[o&&l>1?l-1:l,o&&d>1?d-1:d],c=h[0]/p[0],f=h[1]/p[1],m=1/c,g=1/f,x=new sk(a.shape,o);return i.runWebGPUProgram(x,[s],s.dtype,[{type:"int32",data:h},{type:"int32",data:p},{type:"float32",data:[c]},{type:"float32",data:[f]},{type:"float32",data:[m]},{type:"float32",data:[g]},{type:"int32",data:[2*Math.ceil(m)+2]},{type:"int32",data:[2*Math.ceil(g)+2]}])}};class s${constructor(e,t,i,r){this.variableNames=["x"],this.uniforms="adjustHeightWidth : vec2<f32>, roundBase : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e[0],t,i,e[3]],this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.halfPixelCenters=r,this.shaderKey=`resizeNearest_${r}`}getUserCode(){let e;return e=this.halfPixelCenters?"max((vec2<f32>(rc) + vec2<f32>(0.5)) * effectiveInputOverOutputRatioRC, vec2<f32>(0.0))":"vec2<f32>(rc) * effectiveInputOverOutputRatioRC",`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let d = coords[3];
          let rc = coords.yz;

          let effectiveInSize = vec2<f32>(
            f32(uniforms.xShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.xShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveOutSize = vec2<f32>(
            f32(uniforms.outShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.outShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveInputOverOutputRatioRC =
              effectiveInSize / effectiveOutSize;

          // Fractional source index
          let sourceFracIndexRC = ${e};

          // Compute the coordinators of nearest neighbor point.
          let inputShapeRC = vec2<f32>(f32(uniforms.xShape.y), f32(uniforms.xShape.z));
          let sourceNearestRC = vec2<i32>(
            min(inputShapeRC - 1.0, floor(sourceFracIndexRC + uniforms.roundBase)));
          let newValue = getX(b, sourceNearestRC.x, sourceNearestRC.y, d);

          setOutputAtIndex(index, newValue);
        }
      }
    `}}let sP={kernelName:m.ResizeNearestNeighbor,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a}=t,{alignCorners:s,halfPixelCenters:o,size:n}=r,[u,l]=n,d=s&&u>1?1:0,h=s&&l>1?1:0,p=new s$(a.shape,u,l,o);return i.runWebGPUProgram(p,[a],a.dtype,[{type:"float32",data:[d,h]},{type:"float32",data:[s?.5:0]}])}};class sz{constructor(e,t){this.variableNames=["dy"],this.uniforms=`effectiveXSize : vec2<i32>, effectiveYSize : vec2<i32>, invHeightScale : f32, invWidthScale : f32,
       winHeight : i32, winWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.alignCorners=t,this.shaderKey=`resizeNearestNeigborBackprop_${t}`}getUserCode(){return`
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let b = coords[0];
          let d = coords[3];
          let r = coords[1];
          let c = coords[2];

          var accumulator = 0.0;

          // Compute bounds for where in dy we will look
          let startRLerp = floor(f32(r) * uniforms.invHeightScale);
          let startDyR = i32(floor(startRLerp - f32(uniforms.winHeight / 2)));

          let startCLerp = floor(f32(c) * uniforms.invWidthScale);
          let startDyC = i32(floor(startCLerp - f32(uniforms.winWidth / 2)));

          // Loop over dy
          for (var dyROffset = 0; dyROffset < uniforms.winHeight; dyROffset++) {
            let dyR = startDyR + dyROffset;

            // Guard against the window exceeding the bounds of dy
            if (dyR < 0 || dyR >= uniforms.dyShape[1]) {
              continue;
            }

            for (var dyCOffset = 0; dyCOffset < uniforms.winWidth; dyCOffset++) {
              let dyC = startDyC + dyCOffset;

              // Guard against the window exceeding the bounds of dy
              if (dyC < 0 || dyC >= uniforms.dyShape[2]) {
                continue;
              }

              let sourceFracRow = f32(uniforms.effectiveXSize[0]) *
                  (f32(dyR) / f32(uniforms.effectiveYSize[0]));

              let sourceFracCol = f32(uniforms.effectiveXSize[1]) *
                  (f32(dyC) / f32(uniforms.effectiveYSize[1]));

              let sourceNearestRow =
                  i32(min(f32(uniforms.outShape[1] - 1),
                  ${this.alignCorners?"floor(sourceFracRow + 0.5)":"floor(sourceFracRow)"}));

              let sourceNearestCol =
                  i32(min(f32(uniforms.outShape[2] - 1),
                  ${this.alignCorners?"floor(sourceFracCol + 0.5)":"floor(sourceFracCol)"}));

              if (r == sourceNearestRow && c == sourceNearestCol) {
                accumulator += getDy(b, dyR, dyC, d);
              }
            }
          }
          // End loop over dy

          setOutputAtIndex(index, accumulator);
        }
      }
    `}}let sN={kernelName:m.ResizeNearestNeighborGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a,dy:s}=t,{alignCorners:o}=r,[,n,u]=a.shape,[,l,d]=s.shape,h=[o&&l>1?n-1:n,o&&d>1?u-1:u],p=[o&&l>1?l-1:l,o&&d>1?d-1:d],c=h[0]/p[0],f=h[1]/p[1],m=1/c,g=1/f,x=new sz(a.shape,o);return i.runWebGPUProgram(x,[s],s.dtype,[{type:"int32",data:h},{type:"int32",data:p},{type:"float32",data:[m]},{type:"float32",data:[g]},{type:"int32",data:[2*Math.ceil(m)+2]},{type:"int32",data:[2*Math.ceil(g)+2]}])}};class sA{constructor(e){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=" axis : vec4<i32>,",this.shaderKey="reverse"}getUserCode(){let e=`
      // Using uniform variables as judging conditions, so the function has
      // coherent execution within all threads.
      fn getReverseCoords(coords : vec4<i32>) -> vec4<i32> {
        var reverseCoords = coords;
        if (uniforms.axis[0] == 1) {
          reverseCoords[0] = uniforms.xShape[0] - coords[0] - 1;
        }
        if (uniforms.axis[1] == 1) {
          reverseCoords[1] = uniforms.xShape[1] - coords[1] - 1;
        }
        if (uniforms.axis[2] == 1) {
          reverseCoords[2] = uniforms.xShape[2] - coords[2] - 1;
        }
        if (uniforms.axis[3] == 1) {
          reverseCoords[3] = uniforms.xShape[3] - coords[3] - 1;
        }

        return reverseCoords;
      }
    `;return`
      ${e}
      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let reverseCoords = getReverseCoords(coords);
          setOutputAtIndex(index, getX(reverseCoords[0],
              reverseCoords[1], reverseCoords[2], reverseCoords[3]));
        }
      }
    `}}let sD={kernelName:m.Reverse,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{dims:s}=r,o=a.shape.length;if(0===o)return eJ({inputs:{x:a},backend:i});let n=a.shape,u=[1,1,1,1];n.forEach((e,t)=>{u[t+4-o]=e});let l=m.util.parseAxisParam(s,a.shape),d=[0,0,0,0];l.forEach(e=>{d[e+4-o]=1});let h=eK({inputs:{x:a},backend:i,attrs:{shape:u}}),p=new sA(u),c=i.runWebGPUProgram(p,[h],h.dtype,[{type:"int32",data:d}]);i.disposeData(h.dataId);let f=eK({inputs:{x:c},backend:i,attrs:{shape:n}});return i.disposeData(c.dataId),f}};class sF{constructor(e,t){this.outputShape=[],this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=`centerX : f32, centerY : f32, sinRadians : f32,
          cosRadians : f32,`,this.shaderKey="rotate",this.outputShape=e,"number"==typeof t?(this.uniforms+=" fillValue : f32,",this.fillSnippet="var outputValue = uniforms.fillValue;",this.shaderKey+="_float"):(this.uniforms+=" fillValue : vec3<f32>,",this.fillSnippet="var outputValue = uniforms.fillValue[coords[3]];",this.shaderKey+="_vec3")}getUserCode(){return`
        ${$("index")} {
          if (index < uniforms.size) {
            let coords = getCoordsFromIndex(index);
            let coordXFloat = (f32(coords[2]) - uniforms.centerX) *
                uniforms.cosRadians - (f32(coords[1]) - uniforms.centerY) *
                uniforms.sinRadians;
            let coordYFloat = (f32(coords[2]) - uniforms.centerX) *
                uniforms.sinRadians + (f32(coords[1]) - uniforms.centerY) *
                uniforms.cosRadians;
            let coordX = i32(round(coordXFloat + uniforms.centerX));
            let coordY = i32(round(coordYFloat + uniforms.centerY));
            ${this.fillSnippet}
            if(coordX >= 0 && coordX < uniforms.xShape[2] && coordY >= 0 &&
                coordY < uniforms.xShape[1]) {
              outputValue = getX(coords[0], coordY, coordX, coords[3]);
            }
            setOutputAtIndex(index, outputValue);
          }
        }
      `}}let s_={kernelName:m.RotateWithOffset,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{image:r}=e,{radians:a,fillValue:s,center:o}=t,n=new sF(r.shape,s),[u,l]=m.backend_util.getImageCenter(o,r.shape[1],r.shape[2]),d=[{type:"float32",data:[u]},{type:"float32",data:[l]},{type:"float32",data:[Math.sin(a)]},{type:"float32",data:[Math.cos(a)]}];return"number"==typeof s?d.push({type:"float32",data:[Number.parseFloat(s.toFixed(2))]}):d.push({type:"float32",data:s}),i.runWebGPUProgram(n,[r],r.dtype,d)}},sT=e4({opType:p.ROUND}),sL={kernelName:m.Round,backendName:"webgpu",kernelFunc:sT},sE=e4({opType:p.RSQRT,cpuKernelImpl:tb}),sB={kernelName:m.Rsqrt,backendName:"webgpu",kernelFunc:sE};class sW{constructor(e,t,i,r,a,s,o,n=!0){this.variableNames=["updates","indices"],this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=s,this.type=o,this.sumDupeIndices=n,this.dispatchLayout=U(e),this.dispatch=E(this.dispatchLayout,e,this.workgroupSize),this.sliceDimGreaterThanOne=t>1,this.shaderKey=`scatter_${i}_${r}_${this.sliceDimGreaterThanOne}_${o}_${n}_${a.length}`;let u=k(a.length);this.uniforms=`sliceDim : i32, strides: ${u}, updatesSize: i32,`,this.updatesRank=r,this.indicesRank=i}getUserCode(){let e="";1===this.indicesRank?e="coords[0]":2===this.indicesRank&&(e="coords[0], j");let t=`getIndices(${e})`,i=this.sliceDimGreaterThanOne?"uniforms.strides[j]":"uniforms.strides",r="",a="";1===this.dispatchLayout.x.length?(r="flattenedIndex",a=`
      fn getUpdatesCoordsFromFlatIndex(index : i32) -> i32 {
        return index;
      }
      `):2===this.dispatchLayout.x.length&&(r="vec2<i32>(flattenedIndex, coords[1])",a=`
      fn getUpdatesCoordsFromFlatIndex(index : i32) -> vec2<i32> {
        // N.B. |updates| could be a scalar tensor, conceptually representing a
        // 2D tensor with all values equal to that. By design, its size must be
        // the same as |outShape[1]| in one dimension, and |indicesShape[0]|
        // gives the other.
        let sliceSize = uniforms.outShape[1];
        let d0 = index / sliceSize;
        let d1 = index - d0 * sliceSize;
        return vec2<i32>(d0, d1);
      }
      `);let s=Array.from({length:this.updatesRank},(e,t)=>`coords[${t}]`),o=`getUpdates(${s.join(", ")})`;return`
    ${a}
      ${$("index")} {
        if (index < uniforms.updatesSize) {
          let coords = getUpdatesCoordsFromFlatIndex(index);
          var flattenedIndex = 0;
          for (var j = 0; j < uniforms.sliceDim; j = j + 1) {
            let indexInside = i32(round(${t}));
            flattenedIndex = flattenedIndex + indexInside * ${i};
          }
          let updateValue =
              ${F(this.type)}(${o});
          let flatIndex = getOutputIndexFromCoords(${r});

          ${this.sumDupeIndices?S("&result[flatIndex]","updateValue",this.type):"atomicStore(&result[flatIndex], bitcast<i32>(updateValue));"}
        }
      }`}}let sO={kernelName:m.ScatterNd,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{indices:a,updates:s}=t,{shape:o}=r,{sliceRank:n,numUpdates:u,sliceSize:l,strides:d,outputSize:h}=m.backend_util.calculateShapes(s,a,o),p=[h/l,l];if(0===h)return i.makeTensorInfo(o,a.dtype);let c=eK({inputs:{x:a},backend:i,attrs:{shape:[u,n]}}),f=eK({inputs:{x:s},backend:i,attrs:{shape:[u,l]}}),g=f.dtype,x=eH({backend:i,attrs:{shape:p,value:0,dtype:g}}),y=[{type:"int32",data:[n]},{type:"int32",data:d},{type:"int32",data:[m.util.sizeFromShape(f.shape)]}],w=new sW(f.shape,n,c.shape.length,f.shape.length,d,p,g),b=i.runWebGPUProgram(w,[f,c],g,y,x),C=eK({inputs:{x:b},backend:i,attrs:{shape:o}});return i.disposeData(c.dataId),i.disposeData(f.dataId),i.disposeData(b.dataId),C}};class sU{constructor(e,t){this.outputShape=[],this.variableNames=["sortedSequence","values"],this.uniforms="numInputs : i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.side=t,this.shaderKey=`search_sorted_${t}`}getUserCode(){let e="left"===this.side?"<":"<=";return`
      fn findBound(batch: i32, value: f32) -> i32 {
        var left = i32(0);
        var right = uniforms.numInputs;
        while (left < right) {
          var mid = (left + right) / 2;
          if (getSortedSequence(batch, mid) ${e} value) {
            left = mid + 1;
          } else {
            right = mid;
          }
        }
        return right;
      }

      ${$("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let value = getValuesByOutputIndex(index);
          setOutputAtIndexI32(index, findBound(coords[0], value));
        }
      }
    `}}let sV={kernelName:m.SearchSorted,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{sortedSequence:a,values:s}=t,{side:o}=r,n=new sU([s.shape[0],s.shape[1]],o),u=[{type:"int32",data:[a.shape[1]]}];return i.runWebGPUProgram(n,[a,s],"int32",u)}};class sM{constructor(e,t,i){this.variableNames=["c","a","b"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.cRank=e,this.rank=i,this.shaderKey="select"}getUserCode(){let e,t;if(this.rank>4)throw Error(`Where for rank ${this.rank} is not yet supported`);if(1===this.rank)t="resRC",e="resRC";else{let i=["resRC.x","resRC.y","resRC.z","resRC.w"],r=[],a=[];for(let e=0;e<this.outputShape.length;e++)a.push(`${i[e]}`),e<this.cRank&&r.push(`${i[e]}`);e=r.join(),t=a.join()}return`
      ${$("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          let cVal = getC(${e});
          if (cVal >= 1.0) {
            setOutputAtIndex(index, getA(${t}));
          } else {
            setOutputAtIndex(index, getB(${t}));
          }
        }
      }
    `}}let sG={kernelName:m.Select,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{condition:r,t:a,e:s}=t,o=new sM(r.shape.length,a.shape,a.shape.length);return i.runWebGPUProgram(o,[r,a,s],(0,m.upcastType)(a.dtype,s.dtype))}},sH=e4({opType:p.SELU}),sX={kernelName:m.Selu,backendName:"webgpu",kernelFunc:sH},sK=e4({opType:p.SIGMOID}),sq={kernelName:m.Sigmoid,backendName:"webgpu",kernelFunc:sK},sY=e4({opType:p.SIGN}),sj={kernelName:m.Sign,backendName:"webgpu",kernelFunc:sY},sQ=e4({opType:p.SIN}),sZ={kernelName:m.Sin,backendName:"webgpu",kernelFunc:sQ},sJ=e4({opType:p.SINH}),s2={kernelName:m.Sinh,backendName:"webgpu",kernelFunc:sJ},s3=e4({opType:p.SOFTPLUS}),s0={kernelName:m.Softplus,backendName:"webgpu",kernelFunc:s3};class s1{constructor(e,t,i,r,a,s){this.variableNames=["x"],this.outputShape=[],this.uniforms="",this.workgroupSize=[64,1,1],this.size=!0;let o=Array(r.length);for(let e=0;e<o.length;e++)o[e]=r[a[e]];this.outputShape=o,this.newDim=a,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.xShape=e,this.paddedXShape=t,this.uniforms+=`reshapedPaddedXShape : ${k(r.length)}, paddedXShapeStrides : ${k(s)}, `,i.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.shaderKey=`spaceToBatchND_${a}`}getUserCode(){let e=k(this.outputShape.length),t=tM(this.newDim);return`
      ${A(this.paddedXShape,"PaddedX")}
      ${$("index")} {
        if(index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let switchedIndex = getIndexFromCoords${this.outputShape.length}D(${e}(${t}), uniforms.reshapedPaddedXShape);
          let paddedCoords = getPaddedXCoordsFromIndex(switchedIndex);
          ${sn(this.xShape,!0)}
        }
      }
    `}}let s4={kernelName:m.SpaceToBatchND,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockShape:s,paddings:o}=r;m.util.assert(a.shape.length<=4,()=>"spaceToBatchND for rank > 4 with a WebGPU backend not implemented yet");let n=s.reduce((e,t)=>e*t),u=[[0,0]];u.push(...o);for(let e=1+s.length;e<a.shape.length;++e)u.push([0,0]);let l=u.map((e,t)=>e[0]+a.shape[t]+e[1]),d=m.backend_util.getReshaped(l,s,n,!1),h=m.backend_util.getPermuted(d.length,s.length,!1),p=m.backend_util.getReshapedPermuted(l,s,n,!1),c=m.util.computeStrides(l),f=new s1(a.shape,l,u,d,h,c.length),g=[{type:"int32",data:d},{type:"int32",data:c}];u.map(e=>g.push({type:"int32",data:[e[0],e[1]]}));let x=i.runWebGPUProgram(f,[a],a.dtype,g),y=eK({inputs:{x:x},backend:i,attrs:{shape:p}});return i.disposeData(x.dataId),y}};class s6{constructor(e,t,i){this.variableNames=["input","indices","segmentIds"],this.outputShape=[],this.uniforms="segmentSize : i32, sparseSize : i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e,this.type=i,this.dispatchLayout=U([t]),this.dispatch=E(this.dispatchLayout,[t],this.workgroupSize),this.shaderKey="sparseSegmentSum"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.sparseSize) {
        let indexInSegmentIds = index / uniforms.segmentSize;
        let indexInSegment = index % uniforms.segmentSize;
        let indexInInput = indices[indexInSegmentIds];
        let segmentId = segmentIds[indexInSegmentIds];

        let value = input[indexInInput * uniforms.segmentSize + indexInSegment];
        let outIndex = segmentId * uniforms.segmentSize + indexInSegment;
        ${S("&result[outIndex]","value",this.type)}
      }
    }
  `}}class s5{constructor(e,t){this.variableNames=["segmentIds"],this.outputShape=[],this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=[e],this.dispatchLayout=U(t),this.dispatch=E(this.dispatchLayout,t,this.workgroupSize),this.shaderKey="sparseSegmentIdCountProgram"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.segmentIdsShape) {
        let segmentId = segmentIds[index];
        ${S("&result[segmentId]","1","int32")}
      }
    }
  `}}class s8{constructor(e,t){this.variableNames=["segmentSum","sameSegmentIdCount"],this.outputShape=[],this.uniforms="segmentSize : i32",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.type=t,this.dispatchLayout=U(e),this.dispatch=E(this.dispatchLayout,e,this.workgroupSize),this.shaderKey="sparseSegmentMean"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.size) {
        let segmentId = index / uniforms.segmentSize;
        let count = sameSegmentIdCount[segmentId];
        if (count != 0) {
          ${"float32"===this.type?"setOutputAtIndex(index, segmentSum[index] / f32(count));":"setOutputAtIndexI32(index, segmentSum[index] / count);"}
        }
      }
    }
  `}}function s7(e,t,i,r=!1,a){let s;let o=m.util.sizeFromShape(e.shape)/e.shape[0],n=e.dtype,u=m.util.sizeFromShape(t.shape),l=a.readSync(i.dataId),d=u>0?l[u-1]+1:0,h=e.shape.slice();h[0]=d;let p=u*o,c=eH({backend:a,attrs:{shape:h,value:0,dtype:n}});s=new s6(h,p,n);let f=[{type:"int32",data:[o]},{type:"int32",data:[p]}],g=a.runWebGPUProgram(s,[e,t,i],n,f,c);if(r)return g;let x=eH({backend:a,attrs:{shape:[d],value:0,dtype:"int32"}});s=new s5(d,i.shape);let y=a.runWebGPUProgram(s,[i],"int32",null,x),w=eH({backend:a,attrs:{shape:h,value:0,dtype:n}});s=new s8(h,n),f=[{type:"int32",data:[o]}];let b=a.runWebGPUProgram(s,[g,y],n,f,w);return a.disposeData(g.dataId),a.disposeData(y.dataId),b}let s9={kernelName:m.SparseSegmentMean,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{data:r,indices:a,segmentIds:s}=t;return s7(r,a,s,!1,i)}},oe={kernelName:m.SparseSegmentSum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{data:r,indices:a,segmentIds:s}=t;return s7(r,a,s,!0,i)}};class ot{constructor(e,t){this.variableNames=["A"],this.workgroupSize=[64,1,1],this.size=!0;let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[r]*t[r];this.outputShape=i,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.rank=this.outputShape.length,this.shaderKey="tile"}getUserCode(){let e=function(e,t=""){if(e>=5)throw Error(`Tile for rank ${e} is not yet supported`);if(1===e)return`(resRC % ${t}aShape)`;let i=["resRC.x","resRC.y","resRC.z","resRC.w"],r=[];for(let a=0;a<e;a++)r.push(`(${i[a]} % ${t}aShape[${a}])`);return r.join()}(this.rank,"uniforms.");return`
      ${$("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          setOutputAtIndex(index, getA(${e}));
        }
      }
    `}}function oi(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{reps:s}=r;if(i.shouldExecuteOnCPU([a])||"string"===a.dtype||a.shape.length>=5){let e=i.readSync(a.dataId),t="string"===a.dtype?e.map(e=>m.util.decodeString(e)):e,r=t$((0,m.buffer)(a.shape,a.dtype,t),s);return i.makeTensorInfo(r.shape,r.dtype,r.values)}let o=new ot(a.shape,s);return i.runWebGPUProgram(o,[a],a.dtype)}let or={kernelName:m.Tile,backendName:"webgpu",kernelFunc:oi},oa={kernelName:m.SparseToDense,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{sparseIndices:a,sparseValues:s,defaultValue:o}=t,{outputShape:n}=r,{sliceRank:u,numUpdates:l,sliceSize:d,strides:h,outputSize:p}=m.backend_util.calculateShapes(s,a,n);if("string"===s.dtype){let e=tC(i.bufferSync(a),i.bufferSync(s),n,p,d,l,u,h,m.util.decodeString(i.readSync(o.dataId)[0]),!1);return i.makeTensorInfo(n,e.dtype,e.values)}let c=[p/d,d],f=eK({inputs:{x:a},backend:i,attrs:{shape:[l,u]}}),g=s.shape.length?eK({inputs:{x:s},backend:i,attrs:{shape:[l,d]}}):eJ({inputs:{x:s},backend:i}),x=g.dtype,y=i.makeTensorInfo([],x,m.util.makeZerosTypedArray(1,x)),w=eK({inputs:{x:o},backend:i,attrs:{shape:Array(c.length).fill(1)}}),b=oi({inputs:{x:w},backend:i,attrs:{reps:c}}),C=[{type:"int32",data:[u]},{type:"int32",data:h},{type:"int32",data:[m.util.sizeFromShape([l,d])]}];switch(l){case 0:break;case 1:{let e=new sW([l,d],u,f.shape.length,g.shape.length,h,c,x,!1);i.runWebGPUProgram(e,[g,f],x,C,b)}break;default:{let e=new sW([l,d],u,f.shape.length,y.shape.length,h,c,x,!1);i.runWebGPUProgram(e,[y,f],x,C,b)}{let e=new sW([l,d],u,f.shape.length,g.shape.length,h,c,x);i.runWebGPUProgram(e,[g,f],x,C,b)}}let S=eK({inputs:{x:b},backend:i,attrs:{shape:n}});return i.disposeData(f.dataId),i.disposeData(g.dataId),i.disposeData(w.dataId),i.disposeData(y.dataId),i.disposeData(b.dataId),S}},os={kernelName:m.SplitV,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{numOrSizeSplits:s,axis:o}=r,n=m.util.parseAxisParam(o,a.shape)[0],u=m.backend_util.prepareSplitSize(a,s,n),l=Array(a.shape.length).fill(0),d=a.shape.slice();return u.map(e=>{let t=[...d];t[n]=e;let r=iw({inputs:{x:a},backend:i,attrs:{begin:l,size:t}});return l[n]+=e,r})}},oo=e4({opType:p.SQRT}),on={kernelName:m.Sqrt,backendName:"webgpu",kernelFunc:oo},ou={kernelName:m.Square,backendName:"webgpu",kernelFunc:({inputs:e,backend:t})=>{let{x:i}=e,r=new e1(i.shape,p.SQUARE);return t.runWebGPUProgram(r,[i],i.dtype)}},ol=e6({opType:h.SQUARED_DIFFERENCE}),od={kernelName:m.SquaredDifference,backendName:"webgpu",kernelFunc:ol},oh={kernelName:m.Step,backendName:"webgpu",kernelFunc:function({inputs:e,attrs:t,backend:i}){let{x:r}=e,a=new e1(r.shape,p.STEP,"stepAlpha : f32,"),s=[{type:"float32",data:[t.alpha]}];return i.runWebGPUProgram(a,[r],r.dtype,s)}};class op{constructor(e){this.variableNames=["x"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]);let t=k(this.outputShape.length);this.uniforms=`begin : ${t},  strides : ${t}, `,this.shaderKey="stridedSlice"}getUserCode(){let e=this.outputShape.length,t="";if(1===e)t="coords * uniforms.strides + uniforms.begin";else{let e=0;t=this.outputShape.map((t,i)=>(e++,1===this.outputShape.length?`coords * uniforms.strides[${i}] + uniforms.begin[${i}]`:`coords[${e-1}] * uniforms.strides[${i}] + uniforms.begin[${i}]`)).join(",")}return`
       ${$("index")} {
         if (index < uniforms.size) {
           let coords = getCoordsFromIndex(index);
           setOutputAtIndex(index, getX(${t}));
         }
       }
     `}}let oc={kernelName:m.StridedSlice,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{begin:o,end:n,strides:u,beginMask:l,endMask:d,ellipsisMask:h,newAxisMask:p,shrinkAxisMask:c}=a,{finalShapeSparse:f,finalShape:g,isIdentity:x,sliceDim0:y,isSimpleSlice:w,begin:b,end:C,strides:S}=m.slice_util.sliceInfo(s.shape,o,n,u,l,d,h,p,c);if(x)t=eK({inputs:{x:s},backend:r,attrs:{shape:g}});else if(y||w){m.util.assert(s.shape.length>=1,()=>`Input must have rank at least 1, got: ${s.shape.length}`);let e=m.slice_util.computeOutShape(b,C,S),i=iw({inputs:{x:s},backend:r,attrs:{begin:b,size:e}});t=eK({inputs:{x:i},backend:r,attrs:{shape:g}}),r.disposeData(i.dataId)}else if(r.shouldExecuteOnCPU([s])){let e=r.readSync(s.dataId),i=tI(f,(0,m.buffer)(s.shape,s.dtype,e),S,b);t=r.makeTensorInfo(g,s.dtype,i.values)}else{let e=new op(f),i=[{type:"int32",data:b},{type:"int32",data:S}],a=r.runWebGPUProgram(e,[s],s.dtype,i);t=eK({inputs:{x:a},backend:r,attrs:{shape:g}}),r.disposeData(a.dataId)}return t}},of={kernelName:m.StringNGrams,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{separator:a,nGramWidths:s,leftPad:o,rightPad:n,padWidth:u,preserveShortSequences:l}=r,{data:d,dataSplits:h}=t,[p,c]=tk(i.readSync(d.dataId),i.readSync(h.dataId),a,s,o,n,u,l);return[i.makeTensorInfo([p.length],"string",p),i.makeTensorInfo(h.shape,"int32",c)]}},om=e6({opType:h.SUB,cpuKernelImpl:tR,supportsComplex:!0}),og={kernelName:m.Sub,backendName:"webgpu",kernelFunc:om},ox=e4({opType:p.TAN}),oy={kernelName:m.Tan,backendName:"webgpu",kernelFunc:ox},ow=e4({opType:p.TANH}),ob={kernelName:m.Tanh,backendName:"webgpu",kernelFunc:ow},oC={kernelName:m.TensorScatterUpdate,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{tensor:a,indices:s,updates:o}=t,{}=r,{sliceRank:n,numUpdates:u,sliceSize:l,strides:d,outputSize:h}=m.backend_util.calculateShapes(o,s,a.shape),p=[h/l,l];if(0===h)return i.makeTensorInfo(a.shape,s.dtype);let c=[],f=eK({inputs:{x:s},backend:i,attrs:{shape:[u,n]}});c.push(f);let g=eK({inputs:{x:o},backend:i,attrs:{shape:[u,l]}});c.push(g);let x=eK({inputs:{x:a},backend:i,attrs:{shape:p}});c.push(x);let y=oi({inputs:{x:x},backend:i,attrs:{reps:Array(p.length).fill(1)}}),w=new sW([u,l],n,f.shape.length,g.shape.length,d,p,a.dtype,!1),b=[{type:"int32",data:[n]},{type:"int32",data:d},{type:"int32",data:[m.util.sizeFromShape([u,l])]}],C=i.runWebGPUProgram(w,[g,f],x.dtype,b,y);c.push(C);let S=eK({inputs:{x:C},backend:i,attrs:{shape:a.shape}});return c.forEach(e=>i.disposeData(e.dataId)),S}};class oS{constructor(e){this.variableNames=["x","indices"],this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=`inputSize : i32, firstPass : i32, negativeInf : f32,
        dir : i32, inc : i32,`,this.shaderKey="swap"}getUserCode(){return`
        ${$("index")} {
          if (index < uniforms.size) {
            let outC = getCoordsFromIndex(index);
            let batch = outC[0];
            let elemIdx = outC[1];
            // We compare elements pair-wise within a group of size 2 * inc.
            // The comparing rule for each group alternates between ascending
            // and descending. Within each group, we compare each pair at
            // positions i and i+inc. To decide whether an element at position i
            // is x0 or x1, we mod it by 2 * inc, if the result is smaller than
            // inc, it is in the first half of the group, we denote it as x0,
            // otherwise we denote it as x1.
            // For example, as shown in the Bitonic top K paper referenced
            // above, Figure5(a) shows that element[1] is in the second half of
            // the group when group size is 2, but it is in the first half of
            // the group when group size is 4.
            let isFirstInPair = elemIdx % (2 * uniforms.inc) < uniforms.inc;
            var i = 0;
            if (isFirstInPair) {
              i = elemIdx;
            } else {
              i = elemIdx - uniforms.inc;
            }

            var i0 = 0;
            if (uniforms.firstPass == 1) {
              i0 = i;
            } else {
              i0 = i32(getIndices(batch, i));
            }

            var i1 = 0;
            if (uniforms.firstPass == 1) {
              i1 = i + uniforms.inc;
            } else {
              i1 = i32(getIndices(batch, i + uniforms.inc));
            }

            var x0 = f32(0.0);
            var x1 = f32(0.0);
            if (i0 < uniforms.inputSize) {
              x0 = getX(batch, i0);
            } else {
              x0 = uniforms.negativeInf;
            }
            if (i1 < uniforms.inputSize) {
              x1 = getX(batch, i1);
            } else {
              x1 = uniforms.negativeInf;
            }

            let reverse = elemIdx % (2 * uniforms.dir) >= uniforms.dir;
            let isGreater = x0 > x1 || (x0 == x1 && i1 > i0);
            if (reverse == isGreater) {
              // Elements in opposite order of direction
              let iTemp = i0;
              i0 = i1;
              i1 = iTemp;
            }
            if (isFirstInPair) {
              setOutputAtIndex(index, f32(i0));
            } else {
              setOutputAtIndex(index, f32(i1));
            }
          }
        }
      `}}class ov{constructor(e){this.variableNames=["x","indices"],this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms="inputSize : i32, firstPass : i32, k : i32,",this.shaderKey="merge"}getUserCode(){return`
        ${$("index")} {
          if (index < uniforms.size) {
            let outC = getCoordsFromIndex(index);
            let batch = outC[0];
            let elemIdx = outC[1];
            // The output size is half of the previous size.
            // If the previous sequence is | | | | _ _ _ _  | | | |  _ _ _ _
            // (k=4), we only need to output the indices at positions |, the
            // indices at positions _ can be thrown away, see Figure5(b) After
            // Phase 2 (Merge phase) in the Bitonic Top K paper referenced
            // above.
            // For example, the paper shows we only need to output the orange
            // bars. The output sequence should look like this | | | | | | | |.
            // Because the sequence is halved, to map the output index back to
            // the previous sequence to find the corresponding value, we need
            // to double the index. When we double the index, we basically
            // interpolate a position, so 2i looks like
            // | _ | _ | _ | _ | _ | _ | _. We move the | to the first k
            // position of each 2k positions by - elemIdx % k. E.g. for output
            // at index 4,5,6,7, we want to get the corresponding element at
            // original index 8,9,10,11, for output at index 8,9,10,11,
            // we want to get the corresponding element at original index
            // 16,17,18,19, so on and so forth.

            var i = 0;
            if (elemIdx < uniforms.k) {
              i = elemIdx;
            } else {
              i = elemIdx * 2 - elemIdx % uniforms.k;
            }
            var i0 = 0;
            if (uniforms.firstPass == 1) {
              i0 = i;
            } else {
              i0 = i32(getIndices(batch, i));
            }
            var i1 = 0;
            if (uniforms.firstPass == 1) {
              i1 = i + uniforms.k;
            } else {
              i1 = i32(getIndices(batch, i + uniforms.k));
            }

            let x0 = getX(batch, i0);
            var x1 = f32(0.0);
            if (i1 < uniforms.inputSize) {
              x1 = getX(batch, i1);
            } else {
              x1 = x0;
            }

            if (x0 >= x1) {
              setOutputAtIndex(index, f32(i0));
            } else {
              setOutputAtIndex(index, f32(i1));
            }
          }
        }
      `}}function oI(e,t){null!==t&&e.disposeData(t.dataId)}function ok(e){let t=1;for(;t<e;)t*=2;return t}let oR={kernelName:m.TopK,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{k:s,sorted:o}=r,n=a.shape,u=n[n.length-1];if(i.shouldExecuteOnCPU([a])){let[e,t]=tP(i.readSync(a.dataId),n,a.dtype,s,o);return[i.makeTensorInfo(e.shape,e.dtype,e.values),i.makeTensorInfo(t.shape,t.dtype,t.values)]}if(0===s)return n[n.length-1]=0,[i.makeTensorInfo(n,a.dtype,[]),i.makeTensorInfo(n,"int32",[])];if(1===u)return[a,eH({attrs:{shape:n,dtype:"int32",value:0},backend:i})];let l=m.util.sizeFromShape(n)/u,d=eK({inputs:{x:a},attrs:{shape:[l,u]},backend:i}),h=ok(s),p=ok(u),c=null,f=()=>null===c?[d,d]:[d,c],g=(e,t,r)=>{let a=f(),s=new oS(r),o=[{type:"int32",data:[u]},{type:"int32",data:[null===c?1:0]},{type:"float32",data:[Number.NEGATIVE_INFINITY]},{type:"int32",data:[e]},{type:"int32",data:[t]}],n=c;c=i.runWebGPUProgram(s,a,"int32",o),oI(i,n)};for(let e=1;e<h;e*=2){let t=2*e;for(let i=e;i>=1;i/=2)g(t,i,[l,p])}for(let e=p;e>h;e/=2){let t=f(),r=new ov([l,e/2]),a=[{type:"int32",data:[u]},{type:"int32",data:[null===c?1:0]},{type:"int32",data:[h]}],s=c;c=i.runWebGPUProgram(r,t,"int32",a),oI(i,s);let o=h/2,n=2*o;for(let e=o;e>=1;e/=2)g(n,e,c.shape)}let x=c;c=iw({inputs:{x:c},backend:i,attrs:{begin:0,size:[l,s]}}),oI(i,x);let y=as({inputs:{x:d,indices:c},backend:i,attrs:{axis:1,batchDims:1}});oI(i,d);let w=n.slice(0,-1);w.push(s),x=c,c=eK({inputs:{x:c},attrs:{shape:w},backend:i}),oI(i,x);let b=y;return y=eK({inputs:{x:y},attrs:{shape:w},backend:i}),oI(i,b),[y,c]}};class o${constructor(e){this.variableNames=["Image","Transforms"],this.uniforms="interpolationModeId : i32, fillModeId : i32, fillValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=U(this.outputShape),this.dispatch=E(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="transform"}getUserCode(){return`
          fn mapCoord(outCoord : f32, len : f32) -> f32{
            var inCoord = outCoord;
            if(uniforms.fillModeId == 2) {
              if (inCoord < 0.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz2 = 2.0 * len;
                  if (inCoord < sz2) {
                    inCoord = sz2 * f32(i32(f32(-inCoord / sz2))) +
                    inCoord;
                  }
                  if (inCoord < -len) {
                    inCoord = inCoord + sz2;
                  } else {
                    inCoord = -inCoord - 1.0;
                  }
                }
              } else if (inCoord > len - 1.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz2 = 2.0 * len;
                  inCoord = inCoord - sz2 * f32(i32(f32(inCoord / sz2)));
                  if (inCoord >= len) {
                    inCoord = sz2 - inCoord - 1.0;
                  }
                }
              }
              return clamp(inCoord, 0.0, len - 1.0);
            } else if (uniforms.fillModeId == 3) {
              if (inCoord < 0.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz = len - 1.0;
                  inCoord = inCoord + len * (f32(i32(f32(-inCoord / sz))) + 1.0);
                }
              } else if (inCoord > len - 1.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz = len - 1.0;
                  inCoord = inCoord - len * f32(i32(f32(inCoord / sz)));
                }
              }
              return clamp(inCoord, 0.0, len - 1.0);
            } else if (uniforms.fillModeId == 4) {
              return clamp(outCoord, 0.0, len - 1.0);
            }
            return outCoord;
          }
          fn readWithFillValue(batch : i32, coordY : i32, coordX : i32,
            channel : i32) -> f32 {
            var outputValue : f32;
            if (0 <= coordY && coordY < uniforms.imageShape[1] && 0 <= coordX && coordX < uniforms.imageShape[2]) {
                outputValue = getImage(batch, coordY, coordX, channel);
            } else {
              outputValue = uniforms.fillValue;
            }
            return outputValue;
          }

          ${$("index")} {
            if (index < uniforms.size) {
              let coords = getCoordsFromIndex(index);
              var outputValue : f32;
              let batch = coords[0];
              let x = coords[2];
              let y = coords[1];
              let channel = coords[3];
              let xf = f32(x);
              let yf = f32(y);
              let a1 = getTransforms(batch, 0);
              let a2 = getTransforms(batch, 1);
              let a3 = getTransforms(batch, 2);
              let b1 = getTransforms(batch, 3);
              let b2 = getTransforms(batch, 4);
              let b3 = getTransforms(batch, 5);
              let c1 = getTransforms(batch, 6);
              let c2 = getTransforms(batch, 7);
              let projection = c1 * xf + c2 * yf + 1.0;
              if (projection == 0.0) {
                outputValue = uniforms.fillValue;
              } else {
                let inX = (a1 * xf + a2 * yf + a3) / projection;
                let inY = (b1 * xf + b2 * yf + b3) / projection;
                let mapX = mapCoord(inX, f32(uniforms.imageShape[2]));
                let mapY = mapCoord(inY, f32(uniforms.imageShape[1]));

                if (uniforms.interpolationModeId == 1) {
                  let coordY = i32(round(mapY));
                  let coordX = i32(round(mapX));
                  outputValue = readWithFillValue(batch, coordY, coordX,
                    channel);
                } else {
                  let yFloor = floor(mapY);
                  let xFloor = floor(mapX);
                  let yCeil = yFloor + 1.0;
                  let xCeil = xFloor + 1.0;
                  let valueYFloor = (xCeil - mapX) *
                  readWithFillValue(batch, i32(yFloor), i32(xFloor), channel) +
                  (mapX - xFloor) *
                  readWithFillValue(batch, i32(yFloor), i32(xCeil), channel);
                  let valueYCeil = (xCeil - mapX) *
                  readWithFillValue(batch, i32(yCeil), i32(xFloor), channel) +
                  (mapX - xFloor) *
                  readWithFillValue(batch, i32(yCeil), i32(xCeil), channel);
                  outputValue = (yCeil - mapY) * valueYFloor +
                  (mapY - yFloor) * valueYCeil;
                }
              }
              setOutputAtIndex(index, outputValue);
            }
          }
        `}}let oP={kernelName:m.Transform,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{image:s,transforms:o}=i,{interpolation:n,fillMode:u,fillValue:l,outputShape:d}=a,[h,p,c,f]=s.shape,[m,g]=null!=d?d:[p,c],x=new o$([h,m,g,f]);switch(u){case"constant":default:t=1;break;case"reflect":t=2;break;case"wrap":t=3;break;case"nearest":t=4}let y=[{type:"int32",data:["nearest"===n?1:2]},{type:"int32",data:[t]},{type:"float32",data:[l]}];return r.runWebGPUProgram(x,[s,o],"float32",y)}},oz={kernelName:m.Unpack,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{value:a}=t,{axis:s}=r;s<0&&(s+=a.shape.length);let o=a.shape.length,n=a.shape[s],u=Array(o-1),l=0;for(let e=0;e<o;e++)e!==s&&(u[l++]=a.shape[e]);let d=[],h=Array(o).fill(0),p=a.shape.slice();p[s]=1;let c=Array(n);for(let e=0;e<c.length;e++){h[s]=e;let t=iw({inputs:{x:a},backend:i,attrs:{begin:h,size:p}}),r=eK({inputs:{x:t},backend:i,attrs:{shape:u}});c[e]=r,d.push(t)}return d.forEach(e=>i.disposeData(e.dataId)),c}};class oN{constructor(e,t,i){if(this.outputShape=[],this.variableNames=["x","segmentIds"],this.uniforms="numSegments : i32, xSize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=t,this.dispatchLayout=U(e),this.dispatch=E(this.dispatchLayout,e,this.workgroupSize),"float32"!==i&&"int32"!==i)throw Error(`UnsortedSegmentSum only supports float32 and int32
              types, does not support ${i} type.`);this.type=i,this.shaderKey="unsortedSegmentSum"}getUserCode(){return`
    ${$("index")} {
      if (index < uniforms.xSize) {
        let coords = getXCoordsFromIndex(index);
        let b = coords[0];
        let inCol = coords[1];

        let segmentId = i32(getSegmentIds(inCol));
        if (segmentId >= 0) {
          let flatIndex = b * uniforms.numSegments + segmentId % uniforms.numSegments;
          let value = getX(b, inCol);

          ${S("&result[flatIndex]","value",this.type)}
        }
      }
    }
  `}}for(let e of[ej,tD,t_,tL,tB,tO,tY,tj,tZ,tJ,t3,t1,t6,t8,t9,il,id,ic,im,ig,iC,ik,i$,iD,i_,iE,e0,iO,iH,iQ,i0,i4,i5,i8,i7,re,ri,ra,rl,rd,rh,rc,rb,rC,rx,rv,rk,rP,rz,rA,rL,rB,rW,rU,rM,rH,rK,rY,rZ,eX,r2,r5,r0,r4,r9,ae,at,ar,ao,au,ad,e2,ah,iM,ac,am,ax,ay,ab,aS,aI,aP,aR,aN,aD,a_,aB,aO,ia,aV,aM,aq,aG,aK,aY,io,aj,aZ,a2,a0,a8,rF,a7,a9,se,iz,si,ss,so,sl,sh,sp,sc,sf,iA,sg,sy,sb,sS,eq,sI,sR,sP,sN,sD,s_,sL,sB,sO,sV,sG,sX,sq,sj,sZ,s2,ib,oh,oc,of,a5,s0,s4,s9,oe,oa,os,on,ou,od,og,rT,oy,ob,oC,or,oR,oP,tH,oz,{kernelName:m.UnsortedSegmentSum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,segmentIds:s}=t,{numSegments:o}=r,n=a.shape.length,u=[],l=0,d=m.backend_util.getAxesPermutation([l],n),h=a;null!=d&&(u.push(h=tG({inputs:{x:a},backend:i,attrs:{perm:d}})),l=m.backend_util.getInnerMostAxes(1,n)[0]);let p=m.backend_util.segment_util.computeOutShape(h.shape,l,o),c=m.util.sizeFromShape([h.shape[l]]),f=eK({inputs:{x:h},backend:i,attrs:{shape:[-1,c]}});u.push(f);let g=a.dtype,x=[f.shape[0],o],y=eH({backend:i,attrs:{shape:x,value:0,dtype:g}}),w=new oN(f.shape,x,g),b=[{type:"int32",data:[o]},{type:"int32",data:[m.util.sizeFromShape(f.shape)]}],C=i.runWebGPUProgram(w,[f,s],g,b,y),S=eK({inputs:{x:C},backend:i,attrs:{shape:p}});u.push(C);let v=S;return null!=d&&(u.push(S),v=tG({inputs:{x:v},backend:i,attrs:{perm:m.backend_util.getUndoAxesPermutation(d)}})),u.forEach(e=>i.disposeData(e.dataId)),v}},sa])(0,m.registerKernel)(e)}}]);